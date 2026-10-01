'use strict';
const LAUNCH = new URLSearchParams(location.search); // читаем до очистки адреса
// Мои записи: заметки, дневник, письма, встречи, ответы. Данные хранятся на телефоне (IndexedDB).

const TABS = {
  note:    { title: 'Заметки', add: 'Новая заметка', empty: 'Заметок нет. Нажми + и надиктуй первую.' },
  diary:   { title: 'Дневник', add: 'Запись за сегодня', empty: 'Дневник пуст. Нажми + и расскажи, как прошел день.' },
  mail:    { title: 'Письма', add: 'Новое письмо', empty: 'Черновиков нет. Надиктуй письмо, приложение приведет его в деловой вид.' },
  meeting: { title: 'Встречи', add: 'Новая встреча', empty: 'Встреч нет. Создай встречу и отправь в календарь Samsung.' },
  reply:   { title: 'Ответы', add: 'Ответ на сообщение', empty: 'Вставь входящее сообщение, скажи суть ответа, получи готовый текст.' },
};
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDT = (d = new Date()) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- хранилище ---------- */
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open('zapisi', 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore('items', { keyPath: 'id' }); s.createIndex('type', 'type'); };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const tx = d.transaction('items', mode); const out = fn(tx.objectStore('items'));
      tx.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  };
  return {
    put: item => run('readwrite', s => s.put(item)),
    del: id => run('readwrite', s => s.delete(id)),
    byType: type => run('readonly', s => s.index('type').getAll(type)),
    all: () => run('readonly', s => s.getAll()),
    bulk: items => run('readwrite', s => { items.forEach(i => s.put(i)); }),
  };
})();

/* ---------- настройки ---------- */
const Settings = {
  get() { try { return JSON.parse(localStorage.getItem('settings') || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem('settings', JSON.stringify(v)); } catch { /* приватный режим */ } },
};

/* ---------- голосовой ввод ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_CMDS = [
  [/\s*(новая строка|с новой строки)\s*/gi, '\n'], [/\s*(новый абзац)\s*/gi, '\n\n'],
  [/\s+(запятая)\b\s*/gi, ', '], [/\s+(точка)\b\s*/gi, '. '], [/\s+(вопросительный знак)\s*/gi, '? '],
  [/\s+(восклицательный знак)\s*/gi, '! '], [/\s+(двоеточие)\s*/gi, ': '], [/\s+(тире)\s*/gi, ' - '],
];
function applyCommands(t) { for (const [re, to] of VOICE_CMDS) t = t.replace(re, to); return t; }
function sentenceCase(t) { return t.replace(/(^|[.!?]\s+|\n)([а-яёa-z])/g, (m, a, b) => a + b.toUpperCase()); }

function voiceField(textarea, hint) {
  const status = el('div', { class: 'interim' }, SR ? 'Нажми на микрофон и говори. Команды: "запятая", "точка", "новая строка".' : 'Голосовой ввод не поддерживается в этом браузере. Открой в Chrome.');
  const btn = el('button', { class: 'micbtn', type: 'button', 'aria-label': 'Диктовать' }, '🎙');
  let rec = null, want = false;
  const stop = () => { want = false; if (rec) rec.stop(); btn.classList.remove('rec'); };
  btn.addEventListener('click', () => {
    if (!SR) return toast('Нужен Chrome на Android');
    if (want) return stop();
    rec = new SR(); rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const cur = textarea.value;
          const sep = cur && !/\s$/.test(cur) ? ' ' : '';
          textarea.value = cur + sep + sentenceCase(applyCommands(' ' + txt.trim()).trim());
          textarea.dispatchEvent(new Event('input'));
        } else interim += txt;
      }
      status.textContent = interim ? '… ' + interim : 'Слушаю';
    };
    rec.onerror = e => { if (e.error === 'not-allowed') { toast('Разреши доступ к микрофону'); stop(); } else if (e.error !== 'no-speech') status.textContent = 'Ошибка: ' + e.error; };
    rec.onend = () => { if (want) { try { rec.start(); } catch { /* уже запущен */ } } else btn.classList.remove('rec'); };
    want = true; btn.classList.add('rec'); status.textContent = 'Слушаю'; rec.start();
  });
  textarea._stopVoice = stop;
  return el('div', { class: 'mic' }, btn, el('div', {}, status, hint ? el('div', { class: 'hint' }, hint) : null));
}

/* ---------- локальная правка текста, если ИИ-сервер недоступен ---------- */
function localPolish(kind, text, extra = {}) {
  let t = sentenceCase(text.replace(/[ \t]+/g, ' ').replace(/\s+([,.!?:;])/g, '$1').trim());
  if (t && !/[.!?]$/.test(t) && kind !== 'note') t += '.';
  if (kind === 'mail') t = `Добрый день!\n\n${t}\n\nС уважением,\n${Settings.get().signature || ''}`.trim();
  if (kind === 'reply') t = `${extra.tone === 'дружеский' ? 'Привет!' : 'Добрый день!'} ${t}`;
  return t;
}
const SYSTEM = {
  note: 'Ты редактор заметок. Исправь пунктуацию и очевидные ошибки распознавания речи, разбей на абзацы. Смысл не меняй, ничего не добавляй. Верни только текст.',
  diary: 'Ты редактор личного дневника. Приведи надиктованный текст в порядок: пунктуация, абзацы, убери слова-паразиты. Интонацию и стиль автора сохрани, от первого лица. Верни только текст.',
  mail: 'Ты помощник руководителя в фарме. Оформи надиктованное как деловое письмо на русском: приветствие, суть, четкая просьба или решение, подпись "С уважением". Тон деловой, без канцелярита. Тему письма не пиши. Верни только текст письма.',
  reply: 'Ты помощник руководителя. Напиши ответ на входящее сообщение по тезисам пользователя. Коротко, по делу, в заданном тоне. Верни только текст ответа.',
};
// Прямой вызов Claude с телефона: ключ хранится только на устройстве, сервер не нужен.
async function askClaude(kind, text, extra) {
  const key = Settings.get().apiKey;
  if (!key) throw new Error('не задан ключ Claude в настройках');
  let user = text;
  if (kind === 'reply') user = `Входящее сообщение:
${extra.incoming || ''}

Тезисы ответа:
${text}

Тон: ${extra.tone || 'деловой'}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1500, system: SYSTEM[kind] || SYSTEM.note, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'ошибка ' + r.status);
  return (j.content || []).map(c => c.text || '').join('').trim();
}
async function polish(kind, text, extra = {}) {
  if (!text.trim()) throw new Error('Сначала надиктуй текст');
  try { return await askClaude(kind, text, extra); }
  catch (e) { toast('ИИ недоступен (' + e.message + '). Сделал простую правку.'); return localPolish(kind, text, extra); }
}

/* ---------- календарь ---------- */
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m); }
const icsDate = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
function meetingRange(m) {
  const s = new Date(m.start); const e = new Date(s.getTime() + (Number(m.duration) || 30) * 60000); return [s, e];
}
function buildIcs(m) {
  const [s, e] = meetingRange(m);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moi zapisi//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${m.id}@moi-zapisi`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(s)}`, `DTEND:${icsDate(e)}`,
    `SUMMARY:${icsEscape(m.title || 'Встреча')}`, `LOCATION:${icsEscape(m.place)}`, `DESCRIPTION:${icsEscape(m.notes)}`];
  (m.attendees || '').split(/[,;\s]+/).filter(x => x.includes('@')).forEach(a => lines.push(`ATTENDEE;RSVP=TRUE:mailto:${a}`));
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Напоминание', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
function meetingText(m) {
  const [s, e] = meetingRange(m);
  const f = d => d.toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `${m.title || 'Встреча'}\n${f(s)} - ${pad(e.getHours())}:${pad(e.getMinutes())}${m.place ? '\nМесто: ' + m.place : ''}${m.notes ? '\n\n' + m.notes : ''}`;
}

/* ---------- форма редактирования ---------- */
const state = { tab: 'note', q: '', editing: null };

function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }
function input(item, key, props = {}) {
  const n = el(props.tag || 'input', { type: props.type || 'text', placeholder: props.ph || '', ...props.attrs });
  n.value = item[key] || '';
  n.addEventListener('input', () => { item[key] = n.value; item.updated = Date.now(); dirty = true; });
  return n;
}
let dirty = false;

function openEditor(item, isNew) {
  state.editing = item; dirty = !!isNew;
  const form = $('#form'); form.replaceChildren();
  $('#sheetTitle').textContent = { note: 'Заметка', diary: 'Дневник', mail: 'Письмо', meeting: 'Встреча', reply: 'Ответ' }[item.type];
  const body = (key, ph, hint) => { const t = input(item, key, { tag: 'textarea', ph }); return [voiceField(t, hint), t, t]; };

  if (item.type === 'note') {
    const [mic, , t] = body('body', 'Текст заметки');
    form.append(field('Заголовок', input(item, 'title', { ph: 'Можно оставить пустым' })), mic, t,
      field('Теги через запятую', input(item, 'tags', { ph: 'работа, идеи' })), polishBtn(item, t, 'note'));
  }
  if (item.type === 'diary') {
    const mood = el('div', { class: 'moods' }, MOODS.map((m, i) => el('button', { type: 'button', class: item.mood === i + 1 ? 'on' : '',
      onclick: e => { item.mood = i + 1; dirty = true; [...e.currentTarget.parentNode.children].forEach((c, j) => c.classList.toggle('on', j === i)); } }, m)));
    const [mic, , t] = body('body', 'Как прошел день', 'Подсказка: что получилось, что не получилось, за что благодарен');
    const date = input(item, 'date', { type: 'date' });
    date.addEventListener('change', async () => {
      const ex = (await DB.byType('diary')).find(x => x.date === date.value && x.id !== item.id);
      if (ex) { toast('За эту дату уже есть запись, открываю ее'); openEditor(ex, false); }
    });
    form.append(field('Дата', date), field('Настроение', mood), mic, t, polishBtn(item, t, 'diary'));
  }
  if (item.type === 'mail') {
    const [mic, , t] = body('body', 'Суть письма своими словами', 'Надиктуй суть, потом нажми "Оформить письмо"');
    const subj = input(item, 'subject', { ph: 'Тема письма' });
    const to = input(item, 'to', { type: 'email', ph: 'адрес получателя', attrs: { inputmode: 'email', autocomplete: 'email' } });
    const send = el('button', { class: 'btn primary', type: 'button', onclick: () => sendMail(item) }, 'Отправить в почту');
    const open = null;
    const copy = el('button', { class: 'btn', type: 'button', onclick: () => copyText(`${item.subject || ''}\n\n${item.body || ''}`) }, 'Копировать');
    form.append(field('Кому', to), field('Тема', subj), mic, t,
      el('div', { class: 'actions' }, polishBtn(item, t, 'mail', 'Оформить письмо', () => ({ to: item.to }), subj), send, copy));
  }
  if (item.type === 'meeting') {
    const [mic, , t] = body('notes', 'Повестка или заметки к встрече');
    form.append(field('Название', input(item, 'title', { ph: 'О чем встреча' })),
      el('div', { class: 'row' }, field('Начало', input(item, 'start', { type: 'datetime-local' })),
        field('Минут', input(item, 'duration', { type: 'number', attrs: { min: 5, step: 5, inputmode: 'numeric' } }))),
      field('Место или ссылка', input(item, 'place', { ph: 'Переговорная, Teams, Zoom' })),
      field('Участники (почты через запятую)', input(item, 'attendees', { ph: 'ivanov@company.ru, petrova@company.ru' })), mic, t,
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => addToCalendar(item) }, 'В календарь'),
        el('button', { class: 'btn', type: 'button', onclick: () => inviteByMail(item) }, 'Пригласить письмом'),
        el('button', { class: 'btn', type: 'button', onclick: () => shareOrCopy(meetingText(item)) }, 'Поделиться')));
  }
  if (item.type === 'reply') {
    const inc = input(item, 'incoming', { tag: 'textarea', ph: 'Вставь сообщение, на которое нужно ответить' });
    inc.style.minHeight = '100px';
    const tone = el('select', { onchange: e => { item.tone = e.target.value; dirty = true; } },
      ['деловой', 'дружеский', 'кратко', 'жестко, но вежливо', 'с извинением'].map(x => el('option', { selected: item.tone === x }, x)));
    const [mic, , t] = body('gist', 'Своими словами: что ответить', 'Скажи тезисы, например: согласен, но срок сдвигаем на пятницу');
    const out = input(item, 'result', { tag: 'textarea', ph: 'Здесь появится готовый ответ' });
    const gen = el('button', { class: 'btn primary', type: 'button', onclick: async () => {
      gen.disabled = true; gen.textContent = 'Пишу…';
      try { out.value = item.result = await polish('reply', item.gist || '', { incoming: item.incoming, tone: item.tone }); dirty = true; }
      catch (e) { toast(e.message); } finally { gen.disabled = false; gen.textContent = 'Составить ответ'; }
    } }, 'Составить ответ');
    form.append(field('Входящее сообщение', inc), field('Тон', tone), mic, t, gen, field('Ответ', out),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: () => copyText(item.result) }, 'Копировать'),
        el('button', { class: 'btn', type: 'button', onclick: () => shareOrCopy(item.result) }, 'Отправить через...')));
  }
  $('#sheet').hidden = false; $('#sheet').scrollTop = 0;
}

function polishBtn(item, textarea, kind, label = 'Привести в порядок', extra = () => ({}), subjectInput = null) {
  const b = el('button', { class: 'btn', type: 'button' }, label);
  b.addEventListener('click', async () => {
    b.disabled = true; const old = b.textContent; b.textContent = 'Обрабатываю…';
    try {
      const key = 'body';
      textarea.value = item[key] = await polish(kind, textarea.value, extra()); dirty = true;
      if (kind === 'mail' && !item.subject) item.subject = (item.body.split('\n').find(l => l.length > 12 && !/^(Добрый|Здравствуйте)/i.test(l)) || '').slice(0, 70).replace(/[.!]$/, '');
      if (subjectInput) subjectInput.value = item.subject || '';
    } catch (e) { toast(e.message); } finally { b.disabled = false; b.textContent = old; }
  });
  return b;
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t || ''); toast('Скопировано'); } catch { toast('Не удалось скопировать'); }
}
async function shareOrCopy(t) {
  if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copyText(t);
}
function sendMail(item) {
  if (!item.body) return toast('Сначала напиши текст письма');
  item.sentAt = Date.now(); dirty = true;
  location.href = `mailto:${encodeURIComponent(item.to || '')}?subject=${encodeURIComponent(item.subject || '')}&body=${encodeURIComponent(item.body || '')}`;
}
function addToCalendar(m) {
  if (!m.start) return toast('Укажи начало встречи');
  download(`${(m.title || 'vstrecha').replace(/[^\wа-я-]+/gi, '_')}.ics`, buildIcs(m), 'text/calendar');
  toast('Открой скачанный файл, он добавится в календарь Samsung', 5000);
  m.calendarAt = Date.now(); dirty = true;
}
function inviteByMail(m) {
  if (!m.start) return toast('Укажи начало встречи');
  const to = (m.attendees || '').split(/[,;\s]+/).filter(x => x.includes('@')).join(',');
  location.href = `mailto:${to}?subject=${encodeURIComponent('Приглашение: ' + (m.title || 'встреча'))}&body=${encodeURIComponent('Коллеги, приглашаю на встречу.\n\n' + meetingText(m))}`;
}

async function closeEditor() {
  const it = state.editing; if (!it) return;
  document.querySelectorAll('textarea').forEach(t => t._stopVoice && t._stopVoice());
  const hasContent = ['title', 'body', 'subject', 'to', 'incoming', 'gist', 'result', 'notes'].some(k => (it[k] || '').trim());
  if (dirty && hasContent) { it.updated = Date.now(); await DB.put(it); }
  state.editing = null; $('#sheet').hidden = true; render();
}

/* ---------- список ---------- */
const preview = it => ({
  note: [it.title || (it.body || '').split('\n')[0] || 'Без названия', it.body],
  diary: [`${MOODS[(it.mood || 3) - 1]} ${new Date(it.date + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, it.body],
  mail: [it.subject || it.to || 'Без темы', it.body],
  meeting: [it.title || 'Встреча', it.start ? new Date(it.start).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + (it.place ? ' · ' + it.place : '') : ''],
  reply: [(it.incoming || '').slice(0, 60) || 'Ответ', it.result || it.gist],
}[it.type]);

async function render() {
  $('#title').textContent = TABS[state.tab].title;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  let items = await DB.byType(state.tab);
  const q = state.q.toLowerCase();
  if (q) items = items.filter(i => JSON.stringify(i).toLowerCase().includes(q));
  const key = i => state.tab === 'diary' ? i.date : state.tab === 'meeting' ? i.start || '' : (i.pinned ? 1e15 : 0) + (i.updated || 0);
  items.sort((a, b) => (key(a) < key(b) ? 1 : -1));
  const list = $('#list'); list.replaceChildren();
  if (state.tab === 'diary' && items.length) list.append(diaryStats(items));
  if (!items.length) list.append(el('div', { class: 'empty' }, q ? 'Ничего не найдено' : TABS[state.tab].empty));
  for (const it of items) {
    const [h, p] = preview(it);
    const meta = el('div', { class: 'meta' });
    if (it.tags) it.tags.split(',').map(s => s.trim()).filter(Boolean).forEach(t => meta.append(el('span', { class: 'chip' }, '#' + t)));
    if (it.sentAt) meta.append(el('span', { class: 'chip' }, 'отправлено'));
    if (it.calendarAt) meta.append(el('span', { class: 'chip' }, 'в календаре'));
    if (state.tab !== 'diary' && state.tab !== 'meeting') meta.append(new Date(it.updated || 0).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
    list.append(el('button', { class: 'card', onclick: () => openEditor(it, false) }, el('h3', {}, (it.pinned ? '📌 ' : '') + h), p ? el('p', {}, p) : null, meta));
  }
}
function diaryStats(items) {
  const days = new Set(items.map(i => i.date)); let streak = 0;
  for (let d = new Date(); days.has(dayKey(d)) || (streak === 0 && days.has(dayKey(new Date(d.getTime() - 864e5)))); d = new Date(d.getTime() - 864e5)) { if (days.has(dayKey(d))) streak++; else d = new Date(d.getTime()); if (streak > 4000) break; }
  const words = items.reduce((n, i) => n + (i.body || '').split(/\s+/).filter(Boolean).length, 0);
  return el('div', { class: 'meta' }, el('span', { class: 'chip' }, `Записей: ${items.length}`), el('span', { class: 'chip' }, `Подряд дней: ${streak}`), el('span', { class: 'chip' }, `Слов: ${words}`));
}

async function createNew(type, withMic) {
  let item = { id: uid(), type, created: Date.now(), updated: Date.now() };
  if (type === 'diary') {
    const today = dayKey(); const ex = (await DB.byType('diary')).find(d => d.date === today);
    if (ex) item = ex; else Object.assign(item, { date: today, mood: 3 });
  }
  if (type === 'meeting') {
    const d = new Date(Date.now() + 36e5); d.setMinutes(0, 0, 0); Object.assign(item, { start: localDT(d), duration: 30 });
  }
  if (type === 'reply') item.tone = 'деловой';
  openEditor(item, !item.body && type !== 'diary' ? true : false);
  if (withMic) setTimeout(() => document.querySelector('.micbtn')?.click(), 300);
  return item;
}

/* ---------- резервная копия ---------- */
async function exportAll() {
  download(`zapisi-${dayKey()}.json`, JSON.stringify({ app: 'moi-zapisi', v: 1, items: await DB.all() }, null, 1), 'application/json');
}
async function importAll(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== 'moi-zapisi' || !Array.isArray(j.items)) throw new Error('не тот файл');
    await DB.bulk(j.items); toast(`Загружено записей: ${j.items.length}`); render();
  } catch (e) { toast('Не удалось загрузить: ' + e.message); }
}

function settingsDialog() {
  const s = Settings.get(); const f = $('#form'); f.replaceChildren(); state.editing = null; dirty = false;
  $('#sheetTitle').textContent = 'Настройки'; $('#del').hidden = true;
  const mk = (label, key, ph, type = 'text') => { const i = el('input', { type, placeholder: ph, autocomplete: 'off' }); i.value = s[key] || ''; i.addEventListener('input', () => { s[key] = i.value.trim(); Settings.set(s); }); return field(label, i); };
  f.append(mk('Подпись в письмах', 'signature', 'Эдуард Касьян'),
    mk('Ключ Claude API (для умной правки текста)', 'apiKey', 'sk-ant-...', 'password'),
    el('p', { class: 'hint' }, 'Ключ хранится только на этом телефоне. Без него работает простая правка. Все записи тоже лежат только на телефоне: делай резервную копию из меню, иначе очистка данных Chrome их удалит.'));
  $('#sheet').hidden = false; $('#sheet').dataset.settings = '1';
}

/* ---------- запуск ---------- */
function bind() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.tab = b.dataset.tab; state.q = ''; $('#search').value = ''; render(); } });
  $('#fab').addEventListener('click', () => createNew(state.tab, state.tab === 'note' || state.tab === 'diary'));
  $('#search').addEventListener('input', e => { state.q = e.target.value; render(); });
  $('#back').addEventListener('click', async () => { if ($('#sheet').dataset.settings) { delete $('#sheet').dataset.settings; $('#del').hidden = false; $('#sheet').hidden = true; return; } closeEditor(); });
  $('#del').addEventListener('click', async () => {
    const it = state.editing; if (!it) return;
    if (!confirm('Удалить запись?')) return;
    await DB.del(it.id); state.editing = null; dirty = false; $('#sheet').hidden = true; render();
  });
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; });
  document.addEventListener('click', () => ($('#menu').hidden = true));
  $('#exportBtn').addEventListener('click', exportAll);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => e.target.files[0] && importAll(e.target.files[0]));
  $('#settingsBtn').addEventListener('click', settingsDialog);
  window.addEventListener('pagehide', () => { if (state.editing && dirty) DB.put(state.editing); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.editing && dirty) DB.put(state.editing); });
  history.replaceState(null, '', location.pathname);
}

(async function init() {
  bind();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  await render();
})();

// параметры запуска читаем до replaceState
(function launch() {
  const p = LAUNCH;
  const shared = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n');
  const go = async () => {
    if (shared) { state.tab = 'reply'; const it = await createNew('reply', false); it.incoming = shared; dirty = true; openEditor(it, true); }
    else if (p.get('new')) { state.tab = p.get('new'); await createNew(p.get('new'), p.get('mic') === '1'); }
    render();
  };
  window.addEventListener('DOMContentLoaded', go);
  if (document.readyState !== 'loading') go();
})();
