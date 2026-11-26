# Device Veil

Браузерное расширение (Manifest V3) для **Chrome, Edge и Firefox**, которое снижает уникальность цифрового отпечатка устройства, маскируя браузер под массовый профиль Windows-ПК и защищая активные векторы фингерпринтинга.

## Основные возможности

- **Экран и разрешение (`screen` / `window` / `DPR`)**
  - Стандартизация `screen.width`, `height`, `availWidth`, `availHeight`, `availTop`, `availLeft`, `colorDepth`, `pixelDepth`, `outerWidth`, `outerHeight`, `screenX` / `screenY`, `devicePixelRatio` и `screen.orientation`.
  - Выбор готового массового профиля в popup: `1920×1080 (1x)`, `1536×864 (1.25x)`, `2560×1440 (1x)`, `1366×768 (1x)`.
- **Платформа, ядра и периферия (`navigator`)**
  - Стандартизация `platform` (`Win32`), `hardwareConcurrency` (`8`), `deviceMemory` (`8`), `maxTouchPoints` (`0`) и User-Agent Client Hints (`navigator.userAgentData`, `getHighEntropyValues` только для запрошенных полей).
  - Нормализация `navigator.languages` (удаление редких дополнительных локалей).
  - Стандартизация `navigator.connection` (`4g`, `10 Mbps`, `50 ms`), `navigator.getBattery()`, `navigator.storage.estimate()` и анонимного списка `mediaDevices.enumerateDevices()`.
- **Реалистичный профиль WebGL / WebGPU**
  - Штатные значения Chromium (`WebKit` / `WebKit WebGL`) для `VENDOR`/`RENDERER` и массовый профиль `Google Inc. (Intel)` / `ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)` для `WEBGL_debug_renderer_info`.
  - Маскировка `GPUAdapter.info` в WebGPU и лимитов текстур WebGL.
- **Защита Canvas, Web Audio и системных шрифтов**
  - Сессионный детерминированный микро-шум для `Canvas` (`toDataURL`, `toBlob`, `getImageData` через скрытый клон без искажения видимого изображения на странице) и `AudioBuffer.getChannelData`: повторные вызовы внутри страницы совпадают, но между сессиями подпись меняется.
  - Фильтрация нестандартных системных/кастомных шрифтов (например, `JetBrains Mono`, `Cascadia Code`, `Roboto`, `Helvetica`) в `CanvasRenderingContext2D.font`, `document.fonts.check` и inline `style.fontFamily` при сохранении веб-шрифтов самого сайта.
- **Скрытность и удобство**
  - Защита `Function.prototype.toString` (`[native code]`), работа во всех фреймах на `document_start`, отсутствие служебных DOM-атрибутов и телеметрии.
  - Быстрая пауза защиты для отдельных сайтов и независимые переключатели модулей прямо в popup.

## Установка

### Из релиза (рекомендуется)
1. Скачайте архив `device-veil-v1.1.0.zip` на вкладке [**Releases**](https://github.com/bloodofdeath/device-veil/releases) и распакуйте его.
2. **Chrome / Edge**: откройте `chrome://extensions` (`edge://extensions`), включите **Режим разработчика**, нажмите **Загрузить распакованное** и выберите папку.
3. **Firefox**: откройте `about:debugging#/runtime/this-firefox`, нажмите **Загрузить временное дополнение** и выберите `manifest.json`.

> В Firefox временное дополнение нужно загружать заново после перезапуска браузера.

## Разработка и автотесты

Для запуска модульных тестов (Node.js 18+, без сторонних зависимостей):

```bash
npm test
```

## Ограничения

Расширение не является VPN или прокси: оно не скрывает IP-адрес, системный часовой пояс и сетевые HTTP-заголовки (`User-Agent`, `Accept-Language`). При проблемах совместимости на конкретном сайте поставьте защиту на паузу для этого домена в popup и обновите вкладку.
