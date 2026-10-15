const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../renderer/i18n.js'), 'utf8');

function createI18n(language) {
  const context = vm.createContext({
    state: { data: { settings: { appLanguage: language } } },
    window: {},
  });
  vm.runInContext(source, context, { filename: 'i18n.js' });
  return context.window.i18n;
}

test('central toast localization follows the selected app language for fixed and dynamic messages', () => {
  const russian = createI18n('ru');
  assert.equal(russian.localizeToast('Pack created.'), 'Пак создан.');
  assert.equal(russian.localizeToast('Reading mod 2 of 5...'), 'Чтение мода 2 из 5…');
  assert.equal(russian.localizeToast('Building VPK...'), 'Сборка VPK…');
  assert.equal(
    russian.localizeToast("The special patch could not be applied safely: The special patch could not be applied safely: More than one selected skin targets All Heroes' Default Pet."),
    "Не удалось безопасно применить специальный патч: Не удалось безопасно применить специальный патч: Несколько выбранных скинов используют общий слот «All Heroes' Default Pet». Оставлен последний выбранный вариант.",
  );

  const english = createI18n('en');
  assert.equal(english.localizeToast('Пак создан.'), 'Pack created.');
  assert.equal(english.localizeToast('Нет свободных слотов VPK. Доступный диапазон: pak02_dir.vpk–pak99_dir.vpk.'), 'No free VPK slots available. Available range: pak02_dir.vpk - pak99_dir.vpk.');
});
