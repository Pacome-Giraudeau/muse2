"""Pont Bluetooth pour Muse 2 Lab : pilote le casque avec bleak (Python) et relaie ses paquets BLE bruts au navigateur.

Lancé par `python serveur.py --pont [ADRESSE]` (jamais seul). Facultatif : l'application marche sans, par Web Bluetooth.
Il sert quand Web Bluetooth manque (Firefox, Safari) ou gêne (clic obligatoire, Chrome au premier plan), et laisse le
casque connecté d'un rechargement de page à l'autre. Le serveur y est branché sur /api/pont (flux SSE, voir serveur.py).

Messages (un JSON par événement SSE) :
    {"etat": "connecting" | "connected" | "reconnecting", "essai": n}   état de la liaison avec le casque
    {"etat": "erreur", "message": "…"}                                  échec définitif (bleak absent…)
    {"i": 3, "d": "<base64>"}                                           notification BLE brute de la caractéristique
                                                                        273e00<i>-4c4d-454d-96be-f03bac821358
                                                                        (3-6 EEG, 9 gyro, 10 accéléro, 11 télémétrie,
                                                                        15-17 PPG) : décodée par lib/muse.js, comme en
                                                                        Web Bluetooth (mêmes paquets, mêmes événements).
Dépendance : `pip install bleak` (seulement pour ce pont). `--pont simule` lance un faux casque (sinusoïde alpha) :
essai de la chaîne pont → navigateur sans matériel, ne prouve rien sur le casque réel.
"""
import asyncio, base64, json, math, queue, threading, time

SERVICE_UUID = "273e{:04x}-4c4d-454d-96be-f03bac821358"
CONTROL = 0x0001
EEG = [0x0003, 0x0004, 0x0005, 0x0006]
AUTRES = [0x000B, 0x000A, 0x0009]            # télémétrie, accéléromètre, gyroscope
PPG = [0x000F, 0x0010, 0x0011]
STALL_S = 4.0                                 # aucun paquet EEG pendant ce délai => liaison considérée morte
DELAIS_S = [0.5, 1, 2, 4, 8]                  # attente entre deux essais ; le dernier est répété


def commande(texte):
    """Commande texte du Muse : [longueur, ...ascii, '\\n'] (identique à Muse._cmd de lib/muse.js)."""
    return bytearray([len(texte) + 1, *texte.encode("ascii"), 10])


class Pont:
    """Un thread asyncio qui garde le casque connecté et diffuse les notifications à tous les abonnés."""

    def __init__(self, adresse=None, ppg=True):
        self.adresse = adresse
        self.ppg = ppg
        self._abonnes = set()
        self._verrou = threading.Lock()
        self._etat = {"etat": "connecting", "essai": 1}
        self._arret = False

    # --- abonnés (un par navigateur connecté au flux SSE) ---

    def abonner(self):
        q = queue.Queue(maxsize=4000)
        with self._verrou:
            self._abonnes.add(q)
            q.put(json.dumps(self._etat))
        return q

    def desabonner(self, q):
        with self._verrou:
            self._abonnes.discard(q)

    def _publier(self, msg, retenir=False):
        texte = json.dumps(msg)
        with self._verrou:
            if retenir:
                self._etat = msg
            for q in list(self._abonnes):
                try:
                    q.put_nowait(texte)
                except queue.Full:       # navigateur trop lent ou parti : on le lâche
                    self._abonnes.discard(q)

    def _notif(self, i, donnees):
        self._publier({"i": i, "d": base64.b64encode(bytes(donnees)).decode("ascii")})

    # --- cycle de vie ---

    def demarrer(self):
        threading.Thread(target=lambda: asyncio.run(self._boucle()), daemon=True, name="pont-ble").start()

    def arreter(self):
        self._arret = True

    async def _boucle(self):
        try:
            from bleak import BleakClient, BleakScanner
        except ImportError:
            return self._publier({"etat": "erreur", "message": "bleak n'est pas installé (pip install bleak)"}, True)
        essai = 0
        while not self._arret:
            essai += 1
            self._publier({"etat": "connecting" if essai == 1 else "reconnecting", "essai": essai}, True)
            try:
                adresse = self.adresse or await self._chercher(BleakScanner)
                async with BleakClient(adresse) as client:
                    await self._ouvrir(client)
                    essai = 0
                    self._publier({"etat": "connected"}, True)
                    while client.is_connected and not self._arret and time.monotonic() - self._dernier < STALL_S:
                        await asyncio.sleep(0.5)
                    try:
                        await client.write_gatt_char(SERVICE_UUID.format(CONTROL), commande("h"))
                    except Exception:
                        pass
            except Exception as e:      # casque éteint, hors de portée, pile Bluetooth occupée…
                print("pont BLE :", e, flush=True)
            if not self._arret:
                self._publier({"etat": "reconnecting", "essai": essai + 1}, True)
                await asyncio.sleep(DELAIS_S[min(max(essai, 1) - 1, len(DELAIS_S) - 1)])

    async def _chercher(self, scanner):
        trouve = await scanner.find_device_by_filter(lambda d, ad: bool(d.name) and d.name.startswith("Muse"), timeout=10)
        if trouve is None:
            raise RuntimeError("aucun Muse trouvé (allumé ? à portée ?)")
        return trouve

    async def _ouvrir(self, client):
        self._dernier = time.monotonic()

        def vers(i):
            def rappel(_sender, donnees):
                if i in EEG:
                    self._dernier = time.monotonic()
                self._notif(i, donnees)
            return rappel

        await client.start_notify(SERVICE_UUID.format(CONTROL), lambda *_: None)
        for i in EEG + AUTRES + (PPG if self.ppg else []):
            await client.start_notify(SERVICE_UUID.format(i), vers(i))
        ecrire = lambda t: client.write_gatt_char(SERVICE_UUID.format(CONTROL), commande(t), response=False)
        await ecrire("h")
        await ecrire("p50" if self.ppg else "p21")
        await ecrire("s")
        await ecrire("d")


class PontSimule(Pont):
    """Faux casque : 4 canaux d'une sinusoïde de 10 Hz (20 µV), 256 Hz, paquets de 12 échantillons (~21 ms)."""

    async def _boucle(self):
        self._publier({"etat": "connected"}, True)
        seq, debut = 0, time.monotonic()
        while not self._arret:
            for c, i in enumerate(EEG):
                bits = 0
                for k in range(12):
                    v = 20 * math.sin(2 * math.pi * 10 * (seq * 12 + k) / 256) * (0.6 + 0.2 * c)
                    bits = (bits << 12) | max(0, min(4095, round(v / 0.48828125 + 2048)))
                self._notif(i, seq.to_bytes(2, "big") + bits.to_bytes(18, "big"))
            seq = (seq + 1) % 65536
            await asyncio.sleep(max(0, debut + seq * 12 / 256 - time.monotonic()))
