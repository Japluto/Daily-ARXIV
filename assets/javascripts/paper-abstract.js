(function () {
  "use strict";
  if (window.paperAbstractReady) return;
  window.paperAbstractReady = true;
  const originals = new WeakMap();
  function measure(section) {
    const text = section.querySelector('.abstract-text');
    const toggle = section.querySelector('[data-abstract-toggle]');
    text.classList.add('is-collapsed');
    const overflow = text.scrollHeight > text.clientHeight + 2;
    const expanded = section.dataset.expanded === 'true';
    text.classList.toggle('is-collapsed', overflow && !expanded);
    toggle.hidden = !overflow;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? '收起摘要 ↑' : '展开全文 ↓';
  }
  function init() {
    document.querySelectorAll('[data-paper-abstract]').forEach(section => {
      const text = section.querySelector('.abstract-text');
      if (!originals.has(section)) originals.set(section, text.textContent.trim());
      if (window.renderMathInElement && !section.dataset.mathReady) {
        renderMathInElement(text, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\(', right: '\\)', display: false},
            {left: '\\[', right: '\\]', display: true}
          ],
          throwOnError: false, trust: false, strict: false
        });
        section.dataset.mathReady = 'true';
      }
      section.querySelector('[data-abstract-copy]').hidden = false;
      measure(section);
    });
  }
  async function copyText(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      const active = document.activeElement;
      const field = document.createElement('textarea');
      field.value = text;
      field.readOnly = true;
      field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.append(field);
      field.select();
      let copied;
      try {
        copied = document.execCommand('copy');
      } finally {
        field.remove();
        if (active?.isConnected) active.focus({preventScroll: true});
      }
      if (!copied) throw new Error('copy denied');
    }
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-abstract-copy], [data-abstract-toggle]');
    if (!button) return;
    const section = button.closest('[data-paper-abstract]');
    if (!section) return;
    event.preventDefault();
    if (button.hasAttribute('data-abstract-toggle')) {
      section.dataset.expanded = String(section.dataset.expanded !== 'true');
      measure(section);
      return;
    }
    const status = section.querySelector('[data-abstract-status]');
    try {
      await copyText(originals.get(section));
      status.textContent = '已复制完整摘要原文';
    } catch (_) {
      status.textContent = '复制未获允许，请展开后选择摘要文字复制。';
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
  if (typeof document$ !== 'undefined') document$.subscribe(init);
  window.addEventListener('pageshow', init);
  if (document.fonts) document.fonts.ready.then(init);
  let frame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(init);
  });
}());
