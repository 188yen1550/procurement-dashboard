/** jsdom has no top-layer API; emulate only open/close for component tests.
 * Browser-level inertness and stacking still require a real browser check. */
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
  configurable: true,
  value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
});
Object.defineProperty(HTMLDialogElement.prototype, 'close', {
  configurable: true,
  value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
});
