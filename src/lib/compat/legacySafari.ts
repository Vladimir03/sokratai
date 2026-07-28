// Полифиллы для Safari/iOS 15.0–15.3 (rule 80: официальный baseline проекта — iOS 15).
//
// Зачем это существует. Гейт совместимости онлайн-доски (2026-07-29) показал, что
// `jspdf` использует `Array.prototype.at`, а `jspdf` + `svg2pdf.js` — `Object.hasOwn`.
// Обе появились только в Safari 15.4. В нашем коде такие API запрещены и ловятся
// ревью, но в ЗАВИСИМОСТЯХ их не запретишь — остаётся подстелить полифилл.
//
// ⚠️ Импортируется в `main.tsx` ПЕРВОЙ строкой, до любых ленивых чанков: чанк с
// jspdf грузится по требованию, но подхватывает прототипы на момент исполнения,
// поэтому полифилл обязан быть уже применён.
//
// Полифилим только ДЕЙСТВИТЕЛЬНО нужное. `structuredClone` намеренно НЕ полифилим:
// честной реализации в три строки не существует (циклы, Map/Set, Date), а
// JSON-подделка тихо портила бы данные. Понадобится под mathlive (Фаза 2) —
// брать полноценный пакет и проверять на реальном iOS 15.

function polyfillAt(): void {
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      value: function at(this: unknown[], index: number) {
        const len = this.length;
        const i = Math.trunc(index) || 0;
        const k = i < 0 ? len + i : i;
        return k < 0 || k >= len ? undefined : this[k];
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof String.prototype.at !== 'function') {
    Object.defineProperty(String.prototype, 'at', {
      value: function at(this: string, index: number) {
        const len = this.length;
        const i = Math.trunc(index) || 0;
        const k = i < 0 ? len + i : i;
        return k < 0 || k >= len ? undefined : this[k];
      },
      writable: true,
      configurable: true,
    });
  }
}

function polyfillHasOwn(): void {
  // Каст, потому что `lib` в tsconfig ниже ES2022 и типов `Object.hasOwn` там нет —
  // ровно та причина, по которой полифилл и нужен в рантайме.
  const objectCtor = Object as ObjectConstructor & {
    hasOwn?: (target: object, key: PropertyKey) => boolean;
  };
  if (typeof objectCtor.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      value: function hasOwn(target: object, key: PropertyKey) {
        if (target === null || target === undefined) {
          throw new TypeError('Cannot convert undefined or null to object');
        }
        return Object.prototype.hasOwnProperty.call(Object(target), key);
      },
      writable: true,
      configurable: true,
    });
  }
}

export function installLegacySafariPolyfills(): void {
  polyfillAt();
  polyfillHasOwn();
}

// Side-effect при импорте — это ЕДИНСТВЕННЫЙ надёжный способ применить полифилл
// раньше остальных модулей. Вызов функции в теле `main.tsx` не сработал бы:
// ES-импорты всплывают и вычисляются ДО любых инструкций тела, поэтому патч
// опоздал бы к модулям, которые уже успели выполниться. Идемпотентно (typeof-гарды).
installLegacySafariPolyfills();
