import { sampleGrid, writePng, fieldOf, renderField, stats, DEFAULT_CELL } from './grid.mjs';

export function renderOptions(cfg) {
  return {
    png: cfg.args.value('render', cfg.command === 'render' ? (cfg.subject || 'view.png') : null),
    field: cfg.args.value('field', null),
    cell: cfg.args.num('cell', DEFAULT_CELL),
    scale: cfg.args.num('scale', 3),
    ramp: cfg.args.value('ramp', null),
    fieldStep: cfg.args.num('field-step', 1),
  };
}

export function render(state, opts) {
  const grid = sampleGrid(state.nodes, state.posScale, { cell: opts.cell });
  if (!grid) {
    console.error('[companion] nothing in view to sample');
    return null;
  }

  console.log(`\ngrid ${grid.w}x${grid.h} cell ${grid.cell}`
    + `  origin ${Math.round(grid.x0)},${Math.round(grid.y0)}`
    + `  ${grid.filled} of ${grid.w * grid.h} cells filled (${grid.total} nodes)`);

  if (opts.png) {
    const out = writePng(grid, opts.png, opts.scale);
    console.log(`wrote ${out.file}  ${out.w}x${out.h}`);
  }

  for (const raw of (opts.field ? opts.field.split(',') : [])) {
    const spec = raw.trim();
    const values = fieldOf(grid, spec);
    console.log(`\n== field "${spec}" ==`);
    console.log(renderField(grid, values, { ramp: opts.ramp, step: opts.fieldStep }));
    const st = stats(grid, values, [0, 0, grid.w - 1, grid.h - 1]);
    if (st) {
      console.log(`  n ${st.n}  min ${st.min.toFixed(1)}  p10 ${st.p10.toFixed(1)}`
        + `  median ${st.median.toFixed(1)}  p90 ${st.p90.toFixed(1)}  max ${st.max.toFixed(1)}`);
    }
  }

  return grid;
}
