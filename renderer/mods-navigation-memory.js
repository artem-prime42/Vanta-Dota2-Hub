document.querySelectorAll('.top-tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.lastModsSection = button.dataset.top;
    state.section = button.dataset.top;
  });
});
