/* Interrupteurs des pistes d'amélioration du signal (globale `PipelinePanel`). La logique est dans lib/filters.js.
 *
 *   new PipelinePanel(document.getElementById('pistes'), pipeline, () => {  appelé après chaque changement  });
 *
 * Une ligne par étape de SignalPipeline.STAGES : case à cocher, nom, réglage éventuel, explication.
 */
class PipelinePanel {
  constructor(container, pipeline, onChange = () => {}) {
    this.pipeline = pipeline;
    container.innerHTML = SignalPipeline.STAGES.map((s, i) => `
      <div class="stage" data-stage="${s.id}">
        <label class="stage-head">
          <input type="checkbox" data-on ${pipeline.isEnabled(s.id) ? 'checked' : ''}>
          <span class="stage-n">${i + 1}</span>
          <b>${s.label}</b>
        </label>
        ${s.param ? `<span class="stage-param">${s.param.label}
          <select data-param>${s.param.options.map((o) => `<option value="${o}" ${o === pipeline.getParam(s.id) ? 'selected' : ''}>${o}</option>`).join('')}</select>
          ${s.param.unit}</span>` : ''}
        <p>${s.description}</p>
      </div>`).join('');
    container.querySelectorAll('.stage').forEach((el) => {
      const id = el.dataset.stage;
      el.classList.toggle('off', !pipeline.isEnabled(id));
      el.querySelector('[data-on]').onchange = (e) => {
        pipeline.setEnabled(id, e.target.checked);
        el.classList.toggle('off', !e.target.checked);
        onChange();
      };
      const sel = el.querySelector('[data-param]');
      if (sel) sel.onchange = (e) => { pipeline.setParam(id, +e.target.value); onChange(); };
    });
  }
}
