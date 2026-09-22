import { el } from './util.js';
import { api } from './api.js';

const SUGGESTIONS = [
  'Why this approach?',
  'What happens at this step?',
  'What is the brute force, and why is this better?',
  'What edge case would break this?',
];

export function initChat(state) {
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const suggest = document.getElementById('chat-suggest');
  const history = [];

  for (const text of SUGGESTIONS) {
    const chip = el('button', 'sugg', text);
    chip.type = 'button';
    chip.addEventListener('click', () => { input.value = text; send(); });
    suggest.appendChild(chip);
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  form.addEventListener('submit', event => { event.preventDefault(); send(); });

  function bubble(role, text, cls) {
    const wrap = el('div', `msg ${role}${cls ? ' ' + cls : ''}`);
    wrap.appendChild(el('div', 'who', role === 'user' ? 'You' : 'Tutor'));
    const body = el('div', 'body');
    body.textContent = text;
    wrap.appendChild(body);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return body;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;

    if (!state.traceId) {
      bubble('assistant', 'Run your code first — I answer from the real execution trace.', 'err');
      return;
    }

    log.querySelector('.side-empty')?.remove();
    input.value = '';
    input.style.height = 'auto';
    bubble('user', text);
    history.push({ role: 'user', content: text });

    const body = bubble('assistant', '');
    body.textContent = '…';
    let answer = '';

    try {
      await api.chat(state.traceId, history, state.step, chunk => {
        answer += chunk;
        body.textContent = answer;
        log.scrollTop = log.scrollHeight;
      });
      if (!answer) body.textContent = '(no response)';
      history.push({ role: 'assistant', content: answer });
    } catch (err) {
      body.textContent = err.message;
      body.parentElement.classList.add('err');
      history.pop();
    }
  }

  return { reset() { history.length = 0; } };
}
