const workspace = document.querySelector('#workspace');
let state = { documents: [], events: [] }, selected = '', query = '', filter = 'all', editing = false, busy = false, noticeTimer;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const rub = value => value === null || value === undefined ? 'Не указана' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(value);
const date = value => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
function message(text, error = false) { const node = document.querySelector('#notice'); clearTimeout(noticeTimer); node.textContent = text; node.className = 'notice' + (error ? ' error' : ''); node.setAttribute('role', error ? 'alert' : 'status'); node.hidden = false; noticeTimer = setTimeout(() => { node.hidden = true; }, error ? 12000 : 6000); }
async function api(route, input) {
  let response;
  try { response = await fetch('/api/' + route, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
  catch { throw Error('Нет соединения с приложением. Проверьте, что окно запуска открыто, и обновите страницу.'); }
  let result;
  try { result = await response.json(); }
  catch { throw Error('Не удалось прочитать ответ приложения. Обновите страницу и повторите действие.'); }
  if (!response.ok) throw Error(result.error || 'Операция не выполнена. Повторите попытку.');
  return result;
}
async function refresh() { state = await api('state'); if (!state.documents.some(document => document.id === selected)) selected = state.documents.find(document => document.status === 'review')?.id || state.documents[0]?.id || ''; render(); }
async function act(task, { onError = error => message(error.message, true), onSuccess } = {}) {
  if (busy) return;
  busy = true; workspace.setAttribute('aria-busy', 'true'); workspace.querySelectorAll('button, #file').forEach(control => { control.disabled = true; });
  try { await task(); await refresh(); }
  catch (error) { onError(error); return; }
  finally { busy = false; workspace.setAttribute('aria-busy', 'false'); workspace.querySelectorAll('button, #file').forEach(control => { control.disabled = false; }); }
  onSuccess?.();
}
function status(document) { return `<span class="status ${document.status === 'review' ? 'review' : ''}">${document.status === 'review' ? 'На проверке' : 'Проверен'}</span>`; }
function row(document) { return `<button class="doc-row ${document.id === selected ? 'selected' : ''}" data-select="${escape(document.id)}" aria-pressed="${document.id === selected}"><span class="doc-row-top"><strong>${escape(document.fields.number || 'Без номера')}</strong>${document.demo ? '<span class="example">Пример</span>' : ''}</span><p class="supplier">${escape(document.fields.supplier || 'Поставщик не указан')}</p><span class="doc-row-foot">${status(document)}<span>${rub(document.fields.total)}</span></span></button>`; }
function matchesSearch(document) {
  return `${document.fields.number} ${document.fields.supplier} ${document.filename}`.toLowerCase().includes(query.trim().toLowerCase());
}
function matchingDocuments() {
  return state.documents.filter(document => (filter === 'all' || document.status === filter) && matchesSearch(document));
}
function selectVisibleDocument() {
  if (editing) return;
  const documents = matchingDocuments();
  if (!documents.some(document => document.id === selected)) {
    selected = documents.find(document => document.status === 'review')?.id || documents[0]?.id || '';
  }
}
function updateList() {
  selectVisibleDocument();
  document.querySelector('#doc-list').innerHTML = list();
  if (!editing) document.querySelector('#detail').innerHTML = detail();
}
function list() {
  return matchingDocuments().map(row).join('') || `<p class="empty">${state.documents.length ? 'Документы не найдены. Измените поиск или статус.' : 'Загрузите файл или проверьте учебный счёт.'}</p>`;
}
function itemTable(document) { return document.items.length ? `<table class="items"><thead><tr><th scope="col">Позиция</th><th scope="col">Кол-во</th><th scope="col">Цена</th><th scope="col">Сумма</th></tr></thead><tbody>${document.items.map(item => `<tr><td data-label="Позиция"><span class="cell-value">${escape(item.name || 'Без названия')}</span></td><td data-label="Количество"><span class="cell-value">${Number.isFinite(item.quantity) ? item.quantity.toLocaleString('ru-RU') : '—'}</span></td><td data-label="Цена"><span class="cell-value">${rub(item.price)}</span></td><td data-label="Сумма"><span class="cell-value">${Number.isFinite(item.quantity) && item.price !== null ? rub(item.quantity * item.price) : '—'}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Позиции в файле не указаны. Проверены только реквизиты и итоговая сумма.</p>'; }
function editForm(document) {
  return `<form id="review-form"><p id="review-error" class="review-error" role="alert" tabindex="-1" hidden></p><div class="form-grid"><label class="field wide">Поставщик<input name="supplier" value="${escape(document.fields.supplier)}" maxlength="180" required autocomplete="organization"></label><label class="field">Номер документа<input name="number" value="${escape(document.fields.number)}" maxlength="100" required></label><label class="field">Дата<input type="date" name="date" value="${escape(document.fields.date)}" required></label><label class="field">Итоговая сумма, ₽<input name="total" type="number" min="0.01" max="999999999999.99" step="0.01" value="${document.fields.total ?? ''}" required inputmode="decimal"></label></div>${document.items.length ? `<div class="editor-items"><h3>Позиции документа</h3>${document.items.map((item, index) => `<div class="item-edit"><label class="field">Название<input data-item="${index}" data-key="name" value="${escape(item.name)}" maxlength="200" required></label><label class="field">Количество<input data-item="${index}" data-key="quantity" type="number" min="0" max="1000000000" step="any" value="${Number.isFinite(item.quantity) ? item.quantity : ''}" required></label><label class="field">Цена, ₽<input data-item="${index}" data-key="price" type="number" min="0.01" max="999999999999.99" step="0.01" value="${item.price ?? ''}" required></label></div>`).join('')}</div>` : ''}<div class="actions"><button class="primary" type="submit">Сохранить и подтвердить</button><button type="button" data-action="cancel-edit">Отменить</button></div><p class="field-note">При сохранении реквизиты и суммы проверятся ещё раз. Исходный файл останется прежним.</p></form>`;
}
function openImportedDocument(result) {
  selected = result.item.id;
  editing = false;
  query = '';
  filter = 'all';
  if (result.duplicate) message('Этот файл уже есть в реестре. Открыт сохранённый документ.');
  else if (result.item.status === 'review') message('Документ добавлен. Проверьте отмеченные реквизиты.');
  else message('Документ добавлен. Реквизиты прошли проверку.');
}
function focusDocument() {
  workspace.querySelector('#document-title')?.focus();
}
function detail() {
  const document = state.documents.find(item => item.id === selected);
  if (!document && state.documents.length) return '<article class="paper empty-sheet"><h1>По текущим фильтрам документов нет</h1><p>Измените поисковый запрос или выберите другой статус.</p></article>';
  if (!document) return `<article class="paper empty-sheet"><h1>Проверка счетов и чеков</h1><p>Реестр извлекает из файла поставщика, номер, дату и позиции. Если сумма позиций расходится с итогом, документ ждёт исправления.</p><ol class="workflow"><li>Загрузите файл или откройте учебный счёт.</li><li>Проверьте замечания и исправьте реквизиты.</li><li>Скачайте реестр в CSV.</li></ol></article>`;
  const walkthrough = document.demo && document.filename === 'demo-invoice.txt';
  const incorrectTotal = walkthrough && document.issues.some(issue => issue.startsWith('Сумма позиций'));
  return `<article class="paper" aria-labelledby="document-title"><div class="paper-head" id="document-head"><div><h1 id="document-title" tabindex="-1">${document.fields.number ? 'Документ № ' + escape(document.fields.number) : 'Документ без номера'}</h1><p class="file-name">${escape(document.filename)}</p></div><div class="head-status">${status(document)}${document.demo ? '<span class="example">Вымышленный пример</span>' : ''}</div></div>${document.issues.length ? `<section class="issues"><h2>Что нужно проверить</h2><ul>${document.issues.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>${incorrectTotal ? '<p>Нажмите «Исправить реквизиты» и укажите итог по сумме позиций.</p>' : ''}</section>` : ''}${editing ? editForm(document) : `<div class="document-identity"><div><p class="supplier-name">${escape(document.fields.supplier || 'Поставщик не указан')}</p><p class="date-line">Дата документа: ${escape(document.fields.date || 'не указана')}</p></div><p class="total">${rub(document.fields.total)}<span>Итого</span></p></div>${itemTable(document)}<div class="actions"><button data-action="edit" class="${document.status === 'review' ? 'primary' : ''}">${document.status === 'review' ? 'Исправить реквизиты' : 'Редактировать реквизиты'}</button>${walkthrough && document.status === 'ready' ? '<a class="button subtle" href="/api/export">Выгрузить реестр в CSV</a>' : ''}</div>`}<details class="original"${walkthrough && !editing ? ' open' : ''}><summary>Исходный текст документа</summary><pre>${escape(document.text)}</pre></details><footer class="paper-footer"><span>Добавлен ${date(document.at)}</span>${document.reviewedAt ? `<span>Проверен вручную ${date(document.reviewedAt)}</span>` : '<span>Проверка по правилам</span>'}</footer></article>`;
}
function register() { return `<div class="desk"><aside class="sidebar" aria-label="Загрузка и список документов"><section class="upload"><h2>Добавить документ</h2><input id="file" class="file-input" type="file" accept=".txt,.json,text/plain,application/json"><label for="file" class="button primary">Выбрать файл</label><span class="formats">TXT или JSON в UTF-8, до 500 КБ</span><div class="sample-actions"><button class="demo" data-action="walkthrough">Проверить учебный счёт</button><a href="/examples/demo-invoice.txt">Скачать этот TXT</a></div></section><div class="registry-title"><h2>Документы</h2><span>${state.documents.length} в реестре</span></div><div class="filters"><label class="sr-only" for="search">Поиск по номеру, поставщику или файлу</label><input id="search" type="search" value="${escape(query)}" placeholder="Номер, поставщик или файл"><label class="sr-only" for="filter">Статус документа</label><select id="filter"><option value="all" ${filter === 'all' ? 'selected' : ''}>Все статусы</option><option value="review" ${filter === 'review' ? 'selected' : ''}>На проверке</option><option value="ready" ${filter === 'ready' ? 'selected' : ''}>Проверены</option></select></div><div class="doc-list" id="doc-list">${list()}</div></aside><section class="content" id="detail" aria-label="Просмотр документа">${detail()}</section></div>`; }
function history() { return `<section class="simple"><h1>Журнал обработки</h1><p>Загрузка файлов, пропущенные повторы и ручная проверка. Сохраняются последние 1000 операций.</p>${state.events.length ? `<ol class="history-list">${state.events.map(event => `<li><time datetime="${escape(event.at)}">${date(event.at)}</time><p>${escape(event.message)}</p></li>`).join('')}</ol>` : '<p>Операций пока нет. <a href="#register">Загрузите документ</a>, чтобы начать.</p>'}</section>`; }
function help() { return `<section class="simple"><h1>Как пользоваться</h1><p>Реестр помогает собрать реквизиты счетов и чеков в таблицу и найти ошибки до выгрузки.</p><div class="help-layout"><div><section class="help-section"><h2>Попробовать за минуту</h2><ol><li>Откройте <a href="#register">реестр</a> и нажмите «Проверить учебный счёт». Можно также <a href="/examples/demo-invoice.txt">скачать TXT</a> и загрузить его кнопкой «Выбрать файл».</li><li>В DEMO-104 сумма позиций расходится с итогом. Нажмите «Исправить реквизиты», введите 4 800 ₽ в поле итоговой суммы и сохраните.</li><li>Нажмите «Скачать CSV». Таблица содержит весь реестр со статусами.</li></ol><p>Повторное добавление того же файла не создаёт новую запись. Другой файл с таким же поставщиком и номером отправляется на проверку.</p><button type="button" data-action="demo">Добавить ещё три примера</button></section><section class="help-section"><h2>Что проверяется</h2><ul><li>Наличие поставщика, номера и положительной итоговой суммы.</li><li>Существование даты в формате ГГГГ-ММ-ДД.</li><li>Количество и цена позиций, совпадение их суммы с итогом.</li></ul><p>Проверка не подтверждает подлинность документа. PDF, фотографии, OCR, налоги, скидки и произвольная вёрстка не поддерживаются.</p></section><section class="help-section"><h2>Где сохраняется результат</h2><p>Реквизиты, исходный текст и журнал сохраняются в файле <code>data/register.json</code> внутри папки приложения. Данные остаются после перезапуска. Для резервной копии остановите приложение и скопируйте папку <code>data</code>.</p></section></div><div><section class="help-section"><h2>Формат TXT</h2><p>Реквизиты — каждый на отдельной строке. Позиции необязательны; в каждой строке укажите название, количество и цену через вертикальную черту.</p><pre>Счёт № INV-104\nПоставщик: Учебная мастерская\nДата: 2026-11-13\nКабель | 2 | 750\nИтого: 1500</pre><a href="/examples/invoice.txt">Скачать пример TXT</a></section><section class="help-section"><h2>Формат JSON</h2><pre>{\n  "supplier": "Учебная мастерская",\n  "number": "INV-104",\n  "date": "2026-11-13",\n  "total": 1500,\n  "items": [\n    { "name": "Кабель", "quantity": 2, "price": 750 }\n  ]\n}</pre><a href="/examples/receipt.json">Скачать пример JSON</a><p>Кодировка UTF-8, размер до 500 000 байт, до 200 позиций. Все суммы в этом проекте — в рублях.</p></section></div></div></section>`; }
function render() {
  const page = location.hash.slice(1) || 'register';
  document.querySelectorAll('nav a').forEach(link => { if (link.hash === '#' + page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (page === 'register') selectVisibleDocument();
  workspace.innerHTML = page === 'history' ? history() : page === 'help' ? help() : register();
  workspace.setAttribute('aria-busy', String(busy));
}
workspace.addEventListener('click', event => {
  const selectedButton = event.target.closest('[data-select]');
  if (busy) return;
  if (selectedButton) {
    selected = selectedButton.dataset.select;
    editing = false;
    updateList();
    const mobile = matchMedia('(max-width:800px)').matches;
    const focusTarget = mobile ? document.querySelector('#document-title') : document.querySelector('.doc-row.selected');
    focusTarget?.focus({ preventScroll: !mobile });
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'walkthrough') act(async () => openImportedDocument(await api('demo-invoice', {})), { onSuccess: focusDocument });
  if (action === 'demo') act(async () => { const result = await api('demo', {}); message(result.added ? `Добавлено документов: ${result.added}. Все примеры вымышлены.` : 'Примеры уже есть в реестре. Повторные файлы пропущены.'); editing = false; });
  if (action === 'edit' || action === 'cancel-edit') {
    editing = action === 'edit';
    if (editing) {
      document.querySelector('#detail').innerHTML = detail();
      document.querySelector('[name="supplier"]').focus();
    } else {
      updateList();
      (document.querySelector('[data-action="edit"]') || document.querySelector('#search'))?.focus();
    }
  }
});
workspace.addEventListener('input', event => { if (event.target.id === 'search') { query = event.target.value; updateList(); } });
workspace.addEventListener('change', event => {
  if (event.target.id === 'filter') { filter = event.target.value; updateList(); }
  if (event.target.id === 'file' && event.target.files[0]) {
    const file = event.target.files[0];
    event.target.value = '';
    act(async () => {
      if (!/\.(txt|json)$/i.test(file.name) || file.size > 500000) throw Error('Выберите TXT или JSON размером до 500 000 байт.');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { throw Error('Не удалось прочитать файл. Сохраните его в кодировке UTF-8.'); }
      openImportedDocument(await api('documents', { filename: file.name, text }));
    }, { onSuccess: focusDocument });
  }
});
workspace.addEventListener('submit', event => {
  if (event.target.id !== 'review-form') return;
  event.preventDefault(); const form = event.target, values = Object.fromEntries(new FormData(form));
  const document = state.documents.find(item => item.id === selected);
  const items = document.items.map((item, index) => ({ name: form.querySelector(`[data-item="${index}"][data-key="name"]`).value, quantity: form.querySelector(`[data-item="${index}"][data-key="quantity"]`).value, price: form.querySelector(`[data-item="${index}"][data-key="price"]`).value }));
  const reviewError = form.querySelector('#review-error');
  reviewError.hidden = true;
  act(async () => {
    const updated = await api('documents/' + document.id, { ...values, items });
    editing = false;
    if (filter === 'review') filter = 'all';
    if (!matchesSearch(updated)) query = '';
    message('Реквизиты сохранены. Документ проверен.');
  }, {
    onError: error => {
      if (reviewError.isConnected) {
        reviewError.textContent = error.message;
        reviewError.hidden = false;
        reviewError.focus();
      } else message(error.message, true);
    },
    onSuccess: () => (workspace.querySelector('#document-title') || workspace.querySelector('#search'))?.focus(),
  });
});
addEventListener('hashchange', () => { if (location.hash === '#workspace') return; editing = false; render(); scrollTo({ top: 0 }); });
refresh().then(() => workspace.setAttribute('aria-busy', 'false')).catch(error => { workspace.innerHTML = '<section class="simple"><h1>Не удалось открыть реестр</h1><p>Проверьте, что окно запуска приложения открыто, и обновите страницу.</p><button data-action="retry">Повторить загрузку</button></section>'; workspace.setAttribute('aria-busy', 'false'); message(error.message, true); });
workspace.addEventListener('click', event => { if (event.target.closest('[data-action="retry"]')) act(() => {}); });
