'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const directory = path.join(__dirname, 'data');
const file = path.join(directory, 'register.json');
fs.mkdirSync(directory, { recursive: true });
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, documents: [], events: [] };
if (state.version !== 1 || !Array.isArray(state.documents) || !Array.isArray(state.events)) throw Error('Неверный формат data/register.json. Сохраните файл и восстановите его из резервной копии.');
const clean = (value, limit = 200) => String(value ?? '').normalize('NFC').trim().slice(0, limit);
function fail(message, status = 400) { const error = Error(message); error.status = status; throw error; }
function money(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[\s\u00a0₽]/g, '').replace(',', '.'));
  const rounded = Math.round(number * 100) / 100;
  return rounded > 0 && rounded < 1e12 ? rounded : null;
}
function quantity(value) {
  const number = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(number) && number > 0 && number <= 1e9 ? number : null;
}
function validate(fields, items) {
  const issues = [];
  if (!fields.supplier) issues.push('Укажите поставщика.');
  if (!fields.number) issues.push('Укажите номер документа.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(Date.parse(fields.date)) || new Date(fields.date).toISOString().slice(0, 10) !== fields.date) issues.push('Укажите существующую дату в формате ГГГГ-ММ-ДД.');
  if (fields.total === null) issues.push('Итоговая сумма должна быть больше нуля.');
  const badItems = items.some(item => !item.name || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1e9 || item.price === null);
  if (badItems) issues.push('Проверьте название, количество и цену каждой позиции.');
  if (items.length && !badItems) {
    const sum = Math.round(items.reduce((total, item) => total + item.quantity * item.price, 0) * 100) / 100;
    if (fields.total !== null && sum !== fields.total) issues.push(`Сумма позиций ${sum.toLocaleString('ru-RU')} ₽ не совпадает с итогом ${fields.total.toLocaleString('ru-RU')} ₽.`);
  }
  return issues;
}
function parseItems(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200 || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) fail('Позиции должны быть массивом не более чем из 200 объектов.');
  return value.map(item => ({ name: clean(item.name), quantity: quantity(item.quantity), price: money(item.price) }));
}
function fromObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('В JSON нужен объект с реквизитами документа.');
  const fields = { supplier: clean(value.supplier, 180), number: clean(value.number, 100), date: clean(value.date, 40), total: money(value.total) };
  const items = parseItems(value.items);
  return { fields, items, issues: validate(fields, items) };
}
function parse(filename, text) {
  if (/\.json$/i.test(filename)) {
    let value;
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('Не удалось прочитать JSON. Проверьте запятые, кавычки и скобки в файле.'); }
    return fromObject(value);
  }
  const source = text.replace(/^\uFEFF/, '');
  const get = expression => clean(source.match(expression)?.[1] || '');
  const fields = {
    supplier: get(/^(?:Поставщик|Продавец|Supplier)[ \t]*:[ \t]*([^\r\n]*)\r?$/im),
    number: get(/^(?:Сч[её]т|Чек|Invoice)[ \t]*([№#: \t]*[^\r\n]*)\r?$/im).replace(/^[№#:\s]+/, ''),
    date: get(/^(?:Дата|Date)[ \t]*:[ \t]*([^\r\n]*)\r?$/im),
    total: money(get(/^(?:Итого|К оплате|Total)[ \t]*:[ \t]*([\d\t \u00a0\u202f.,]+₽?)[ \t]*\r?$/im))
  };
  const items = [];
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const parts = line.split('|');
    if (parts.length !== 3) fail('В строке позиции TXT нужны три поля: название | количество | цена.');
    items.push({ name: clean(parts[0]), quantity: quantity(parts[1]), price: money(parts[2]) });
  }
  if (items.length > 200) fail('В документе допустимо не более 200 позиций.');
  return { fields, items, issues: validate(fields, items) };
}
function commit(message, mutate) {
  const next = structuredClone(state);
  const result = mutate(next);
  next.events.unshift({ id: randomUUID(), at: new Date().toISOString(), message });
  next.events = next.events.slice(0, 1000);
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temporary, file);
  state = next;
  return result;
}
function addDocument(input) {
  const filename = clean(path.basename(String(input.filename ?? '').replace(/\\/g, '/')), 180);
  const text = typeof input.text === 'string' ? input.text : '';
  if (!/\.(txt|json)$/i.test(filename)) fail('Выберите файл TXT или JSON. PDF и фотографии не поддерживаются.');
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > 500000 || text.includes('\u0000') || text.includes('\uFFFD')) fail('Нужен непустой файл UTF-8 размером до 500 000 байт.');
  const key = createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  const existing = state.documents.find(document => document.key === key);
  if (existing) return commit(`Повтор файла ${filename} пропущен`, () => ({ duplicate: true, item: existing }));
  const parsed = parse(filename, text);
  const prior = state.documents.find(document => parsed.fields.number && parsed.fields.supplier && document.fields.number.toLowerCase() === parsed.fields.number.toLowerCase() && document.fields.supplier.toLowerCase() === parsed.fields.supplier.toLowerCase());
  if (prior) parsed.issues.push('Такой поставщик и номер уже есть. Сверьте документы: возможно, это дубль.');
  const item = { id: randomUUID(), key, filename, ...parsed, status: parsed.issues.length ? 'review' : 'ready', at: new Date().toISOString(), demo: input.demo === true, text };
  return commit(`${filename}: ${item.status === 'ready' ? 'добавлен в реестр' : 'требует проверки'}`, next => { next.documents.unshift(item); return { item, duplicate: false }; });
}
function reviewDocument(id, input) {
  const previous = state.documents.find(document => document.id === id);
  if (!previous) fail('Документ не найден.', 404);
  const parsed = fromObject({ ...input, items: input.items === undefined ? previous.items : input.items });
  if (parsed.issues.length) fail(parsed.issues.join(' '));
  if (state.documents.some(document => document.id !== id && document.fields.number.toLowerCase() === parsed.fields.number.toLowerCase() && document.fields.supplier.toLowerCase() === parsed.fields.supplier.toLowerCase())) fail('Такой номер у поставщика уже зарегистрирован. Уточните номер или поставщика.');
  return commit(`${previous.filename}: реквизиты проверены вручную`, next => {
    const document = next.documents.find(item => item.id === id);
    Object.assign(document, parsed, { status: 'ready', reviewedAt: new Date().toISOString() });
    return document;
  });
}
module.exports = { addDocument, reviewDocument, snapshot: () => structuredClone(state) };
