// UI — category and cube-type filter button state.

export function updateCategoryButtons(el, categoryFilter) {
  if (!el) return;
  el.querySelectorAll('button[data-category]').forEach(btn => {
    const value = btn.dataset.category;
    btn.classList.toggle('active', value === 'all' ? categoryFilter === null : categoryFilter === Number(value));
  });
}

export function updateCubeTypeButtons(el, cubeTypeFilter) {
  if (!el) return;
  el.querySelectorAll('button[data-cube-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cubeType === cubeTypeFilter);
  });
}
