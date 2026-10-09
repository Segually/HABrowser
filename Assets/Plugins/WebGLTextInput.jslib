mergeInto(LibraryManager.library, {
  $HATextInput: {
    receiver: '', panel: null, input: null, composing: false,
    send: function(method, value) { SendMessage(HATextInput.receiver, method, value || ''); },
    open: function(value, label, limit, multiline, secure, numeric) {
      HATextInput.close();
      var backdrop = document.createElement('div');
      backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      var panel = document.createElement('form');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Edit text');
      panel.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;z-index:2147483647;box-sizing:border-box;max-width:600px;margin:auto;padding:16px;background:#000;color:#fff;border:1px solid #555;font:16px sans-serif';
      var caption = document.createElement('label');
      caption.textContent = label || 'Edit text';
      caption.htmlFor = 'ha-browser-text';
      caption.style.cssText = 'display:block;margin-bottom:8px';
      var input = document.createElement(multiline ? 'textarea' : 'input');
      input.id = 'ha-browser-text';
      if (!multiline) input.type = secure ? 'password' : 'text';
      if (numeric) input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (limit > 0) input.maxLength = limit;
      input.value = value;
      input.style.cssText = 'box-sizing:border-box;display:block;width:100%;font:18px sans-serif;padding:10px;background:#151515;color:#fff;border:1px solid #777;border-radius:0';
      if (multiline) input.rows = 3;
      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:12px';
      ['Cancel', 'Done'].forEach(function(label) {
        var button = document.createElement('button');
        button.type = label === 'Done' ? 'submit' : 'button';
        button.textContent = label;
        button.style.cssText = 'font:16px sans-serif;padding:10px 18px;background:#151515;color:#fff;border:1px solid #777';
        if (label === 'Cancel') button.onclick = function() { HATextInput.send('OnBrowserCancel'); };
        actions.appendChild(button);
      });
      panel.appendChild(caption); panel.appendChild(input); panel.appendChild(actions);
      // Keep text/IME events out of Unity's canvas keyboard handlers.
      ['keydown', 'keyup', 'keypress'].forEach(function(type) {
        input.addEventListener(type, function(event) {
          event.stopPropagation();
          if (type === 'keydown' && event.key === 'Escape') { event.preventDefault(); HATextInput.send('OnBrowserCancel'); }
        });
      });
      input.addEventListener('compositionstart', function() { HATextInput.composing = true; });
      input.addEventListener('compositionend', function() { HATextInput.composing = false; HATextInput.send('OnBrowserText', input.value); });
      input.addEventListener('input', function() { if (!HATextInput.composing) HATextInput.send('OnBrowserText', input.value); });
      panel.onsubmit = function(event) { event.preventDefault(); if (!HATextInput.composing) HATextInput.send('OnBrowserDone', input.value); };
      HATextInput.panel = backdrop; HATextInput.input = input; HATextInput.composing = false;
      backdrop.appendChild(panel);
      document.body.appendChild(backdrop);
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    },
    close: function() {
      if (HATextInput.panel) HATextInput.panel.remove();
      HATextInput.panel = null; HATextInput.input = null; HATextInput.composing = false;
    }
  },
  HA_TextInputInit__deps: ['$HATextInput'],
  HA_TextInputInit: function(receiver) {
    HATextInput.receiver = UTF8ToString(receiver);
    var canvas = Module.canvas;
    var start = null;
    canvas.addEventListener('touchstart', function(event) {
      start = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    }, { capture: true, passive: true });
    canvas.addEventListener('touchcancel', function() { start = null; }, { capture: true, passive: true });
    // Touchend remains a trusted user gesture. Run before Unity's queued input.
    canvas.addEventListener('touchend', function(event) {
      if (HATextInput.panel || !start || event.changedTouches.length !== 1) { start = null; return; }
      var touch = event.changedTouches[0], rect = canvas.getBoundingClientRect();
      var moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
      start = null;
      if (moved > 20) return;
      var x = (touch.clientX - rect.left) / rect.width;
      var y = 1 - (touch.clientY - rect.top) / rect.height;
      HATextInput.send('OnBrowserTap', x + ',' + y);
      // Unity must still receive touchend so its touch state is released.
      if (HATextInput.panel) event.preventDefault();
    }, { capture: true, passive: false });
  },
  HA_TextInputOpen__deps: ['$HATextInput'],
  HA_TextInputOpen: function(value, label, limit, multiline, secure, numeric) {
    HATextInput.open(UTF8ToString(value), UTF8ToString(label), limit, multiline, secure, numeric);
  },
  HA_TextInputValue__deps: ['$HATextInput'],
  HA_TextInputValue: function(value) {
    var input = HATextInput.input, text = UTF8ToString(value);
    if (input && input.value !== text) {
      var start = input.selectionStart, end = input.selectionEnd;
      input.value = text;
      input.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length));
    }
  },
  HA_TextInputClose__deps: ['$HATextInput'],
  HA_TextInputClose: function() { HATextInput.close(); }
});
