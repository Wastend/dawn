class CartRemoveButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();
      const cartItems = this.closest('cart-items') || this.closest('cart-drawer-items');
      cartItems.updateQuantity(this.dataset.index, 0, event);
    });
  }
}

customElements.define('cart-remove-button', CartRemoveButton);

class CartItems extends HTMLElement {
  constructor() {
    super();
    this.lineItemStatusElement =
      document.getElementById('shopping-cart-line-item-status') || document.getElementById('CartDrawer-LineItemStatus');

    const debouncedOnChange = debounce((event) => {
      this.onChange(event);
    }, ON_CHANGE_DEBOUNCE_TIMER);

    this.addEventListener('change', debouncedOnChange.bind(this));
  }

  cartUpdateUnsubscriber = undefined;

  connectedCallback() {
    this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
      if (event.source === 'cart-items') {
        return;
      }
      return this.onCartUpdate();
    });
  }

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  resetQuantityInput(id) {
    const input = this.querySelector(`#Quantity-${id}`);
    input.value = input.getAttribute('value');
    this.isEnterPressed = false;
  }

  setValidity(event, index, message) {
    event.target.setCustomValidity(message);
    event.target.reportValidity();
    this.resetQuantityInput(index);
    event.target.select();
  }

  validateQuantity(event) {
    const inputValue = parseInt(event.target.value);
    const index = event.target.dataset.index;
    let message = '';

    if (inputValue < event.target.dataset.min) {
      message = window.quickOrderListStrings.min_error.replace('[min]', event.target.dataset.min);
    } else if (inputValue > parseInt(event.target.max)) {
      message = window.quickOrderListStrings.max_error.replace('[max]', event.target.max);
    } else if (inputValue % parseInt(event.target.step) !== 0) {
      message = window.quickOrderListStrings.step_error.replace('[step]', event.target.step);
    }

    if (message) {
      this.setValidity(event, index, message);
    } else {
      event.target.setCustomValidity('');
      event.target.reportValidity();
      this.updateQuantity(
        index,
        inputValue,
        event,
        document.activeElement.getAttribute('name'),
        event.target.dataset.quantityVariantId
      );
    }
  }

  onChange(event) {
    if (!event.target || !event.target.classList.contains('quantity__input')) {
      return;
    }
    this.validateQuantity(event);
  }

  onCartUpdate() {
    if (this.tagName === 'CART-DRAWER-ITEMS') {
      return fetch(`${routes.cart_url}?section_id=cart-drawer`)
        .then((response) => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');
          const selectors = ['cart-drawer-items', '.cart-drawer__footer'];
          for (const selector of selectors) {
            const targetElement = document.querySelector(selector);
            const sourceElement = html.querySelector(selector);
            if (targetElement && sourceElement) {
              targetElement.replaceWith(sourceElement);
            }
          }
          window.updateRequiredCheckoutFields?.();
        })
        .catch((e) => {
          console.error(e);
        });
    } else {
      return fetch(`${routes.cart_url}?section_id=main-cart-items`)
        .then((response) => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');
          const sourceQty = html.querySelector('cart-items');
          this.innerHTML = sourceQty.innerHTML;
          window.updateRequiredCheckoutFields?.();
        })
        .catch((e) => {
          console.error(e);
        });
    }
  }

  getSectionsToRender() {
    return [
      {
        id: 'main-cart-items',
        section: document.getElementById('main-cart-items').dataset.id,
        selector: '.js-contents',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
      {
        id: 'cart-live-region-text',
        section: 'cart-live-region-text',
        selector: '.shopify-section',
      },
      {
        id: 'main-cart-footer',
        section: document.getElementById('main-cart-footer').dataset.id,
        selector: '.js-contents',
      },
    ];
  }

  updateQuantity(line, quantity, event, name, variantId) {
    const eventTarget = event.currentTarget instanceof CartRemoveButton ? 'clear' : 'change';
    const cartPerformanceUpdateMarker = CartPerformance.createStartingMarker(`${eventTarget}:user-action`);

    this.enableLoading(line);

    const body = JSON.stringify({
      line,
      quantity,
      sections: this.getSectionsToRender().map((section) => section.section),
      sections_url: window.location.pathname,
    });

    fetch(`${routes.cart_change_url}`, { ...fetchConfig(), ...{ body } })
      .then((response) => {
        return response.text();
      })
      .then((state) => {
        const parsedState = JSON.parse(state);

        CartPerformance.measure(`${eventTarget}:paint-updated-sections`, () => {
          const quantityElement =
            document.getElementById(`Quantity-${line}`) || document.getElementById(`Drawer-quantity-${line}`);
          const items = document.querySelectorAll('.cart-item');

          if (parsedState.errors) {
            quantityElement.value = quantityElement.getAttribute('value');
            this.updateLiveRegions(line, parsedState.errors);
            return;
          }

          this.classList.toggle('is-empty', parsedState.item_count === 0);
          const cartDrawerWrapper = document.querySelector('cart-drawer');
          const cartFooter = document.getElementById('main-cart-footer');

          if (cartFooter) cartFooter.classList.toggle('is-empty', parsedState.item_count === 0);
          if (cartDrawerWrapper) cartDrawerWrapper.classList.toggle('is-empty', parsedState.item_count === 0);

          this.getSectionsToRender().forEach((section) => {
            const elementToReplace =
              document.getElementById(section.id).querySelector(section.selector) ||
              document.getElementById(section.id);
            elementToReplace.innerHTML = this.getSectionInnerHTML(
              parsedState.sections[section.section],
              section.selector
            );
          });
          window.updateRequiredCheckoutFields?.();
          const updatedValue = parsedState.items[line - 1] ? parsedState.items[line - 1].quantity : undefined;
          let message = '';
          if (items.length === parsedState.items.length && updatedValue !== parseInt(quantityElement.value)) {
            if (typeof updatedValue === 'undefined') {
              message = window.cartStrings.error;
            } else {
              message = window.cartStrings.quantityError.replace('[quantity]', updatedValue);
            }
          }
          this.updateLiveRegions(line, message);

          const lineItem =
            document.getElementById(`CartItem-${line}`) || document.getElementById(`CartDrawer-Item-${line}`);
          if (lineItem && lineItem.querySelector(`[name="${name}"]`)) {
            cartDrawerWrapper
              ? trapFocus(cartDrawerWrapper, lineItem.querySelector(`[name="${name}"]`))
              : lineItem.querySelector(`[name="${name}"]`).focus();
          } else if (parsedState.item_count === 0 && cartDrawerWrapper) {
            trapFocus(cartDrawerWrapper.querySelector('.drawer__inner-empty'), cartDrawerWrapper.querySelector('a'));
          } else if (document.querySelector('.cart-item') && cartDrawerWrapper) {
            trapFocus(cartDrawerWrapper, document.querySelector('.cart-item__name'));
          }
        });

        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items', cartData: parsedState, variantId: variantId });
      })
      .catch(() => {
        this.querySelectorAll('.loading__spinner').forEach((overlay) => overlay.classList.add('hidden'));
        const errors = document.getElementById('cart-errors') || document.getElementById('CartDrawer-CartErrors');
        errors.textContent = window.cartStrings.error;
      })
      .finally(() => {
        this.disableLoading(line);
        CartPerformance.measureFromMarker(`${eventTarget}:user-action`, cartPerformanceUpdateMarker);
      });
  }

  updateLiveRegions(line, message) {
    const lineItemError =
      document.getElementById(`Line-item-error-${line}`) || document.getElementById(`CartDrawer-LineItemError-${line}`);
    if (lineItemError) lineItemError.querySelector('.cart-item__error-text').textContent = message;

    this.lineItemStatusElement.setAttribute('aria-hidden', true);

    const cartStatus =
      document.getElementById('cart-live-region-text') || document.getElementById('CartDrawer-LiveRegionText');
    cartStatus.setAttribute('aria-hidden', false);

    setTimeout(() => {
      cartStatus.setAttribute('aria-hidden', true);
    }, 1000);
  }

  getSectionInnerHTML(html, selector) {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector).innerHTML;
  }

  enableLoading(line) {
    const mainCartItems = document.getElementById('main-cart-items') || document.getElementById('CartDrawer-CartItems');
    mainCartItems.classList.add('cart__items--disabled');

    const cartItemElements = this.querySelectorAll(`#CartItem-${line} .loading__spinner`);
    const cartDrawerItemElements = this.querySelectorAll(`#CartDrawer-Item-${line} .loading__spinner`);

    [...cartItemElements, ...cartDrawerItemElements].forEach((overlay) => overlay.classList.remove('hidden'));

    document.activeElement.blur();
    this.lineItemStatusElement.setAttribute('aria-hidden', false);
  }

  disableLoading(line) {
    const mainCartItems = document.getElementById('main-cart-items') || document.getElementById('CartDrawer-CartItems');
    mainCartItems.classList.remove('cart__items--disabled');

    const cartItemElements = this.querySelectorAll(`#CartItem-${line} .loading__spinner`);
    const cartDrawerItemElements = this.querySelectorAll(`#CartDrawer-Item-${line} .loading__spinner`);

    cartItemElements.forEach((overlay) => overlay.classList.add('hidden'));
    cartDrawerItemElements.forEach((overlay) => overlay.classList.add('hidden'));
  }
}

customElements.define('cart-items', CartItems);

if (!window.cartRequiredFieldValidationInitialized) {
  window.cartRequiredFieldValidationInitialized = true;

  const getUploadGroups = (form) => Array.from(form.querySelectorAll('[data-required-upload-line]'));

  const isGroupComplete = (group) => {
    const hasUploaded = group.dataset.hasUpload === 'true';
    return hasUploaded;
  };

  const getGroupFileInput = (group) => group.querySelector('[data-required-upload-input]');

  const groupHasSelectedFile = (group) => {
    const input = getGroupFileInput(group);
    return !!(input && input.files && input.files.length > 0);
  };

  const setUploadStatus = (group, message, isError = false) => {
    let status = group.querySelector('[data-upload-status]');
    if (!status) {
      status = document.createElement('p');
      status.className = 'cart-item__required-upload-status';
      status.setAttribute('data-upload-status', '');
      group.appendChild(status);
    }

    status.classList.remove('hidden');
    status.textContent = message;
    status.classList.toggle('cart-item__required-upload-status--error', isError);
  };

  const uploadGroupFile = async (group) => {
    const input = getGroupFileInput(group);
    const line = group.dataset.line;
    const quantity = group.dataset.quantity;
    if (!input || !input.files || input.files.length === 0) {
      throw new Error('Please choose a file for each product.');
    }

    if (!line || !quantity) {
      throw new Error('Unable to detect cart line for file upload.');
    }

    const formData = new FormData();
    formData.append('line', line);
    formData.append('quantity', quantity);
    formData.append('properties[Prescription file]', input.files[0]);

    const response = await fetch(`${routes.cart_change_url}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to save one of the files.');
    }

    group.dataset.hasUpload = 'true';
    setUploadStatus(group, 'File saved.', false);
  };

  const syncFormState = (form) => {
    const groups = getUploadGroups(form);
    if (!groups.length) return true;

    let valid = true;
    groups.forEach((group) => {
      const complete = isGroupComplete(group);
      group.classList.toggle('cart-item__required-upload--missing', !complete);
      valid = valid && complete;
    });

    const message =
      form.querySelector('[data-required-checkout-message]') ||
      document.querySelector(`[data-required-checkout-message][data-form-id="${form.id}"]`);
    if (message) message.classList.toggle('hidden', valid);

    const buttons = form.querySelectorAll('button[name="checkout"]');
    buttons.forEach((button) => {
      if (!button.dataset.initialDisabled) {
        button.dataset.initialDisabled = button.disabled ? 'true' : 'false';
      }

      const initiallyDisabled = button.dataset.initialDisabled === 'true';
      button.disabled = initiallyDisabled || !valid;
    });

    return valid;
  };

  window.updateRequiredCheckoutFields = () => {
    document.querySelectorAll('form.cart__contents').forEach((form) => syncFormState(form));
  };

  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-required-upload-input]')) return;
    const form = event.target.closest('form.cart__contents');
    const group = event.target.closest('.cart-item__required-upload');
    if (group && group.dataset.hasUpload === 'true' && groupHasSelectedFile(group)) {
      group.dataset.hasUpload = 'false';
      setUploadStatus(group, 'New file selected. It will be saved on checkout.', false);
    }
    if (form) syncFormState(form);
  });

  document.addEventListener(
    'submit',
    async (event) => {
      const form = event.target.closest('form.cart__contents');
      if (!form) return;
      const submitter = event.submitter;

      if (form.dataset.allowCheckoutSubmit === 'true') {
        delete form.dataset.allowCheckoutSubmit;
        return;
      }

      const isCheckoutSubmit = submitter && submitter.name === 'checkout';
      if (!isCheckoutSubmit) return;

      if (form.dataset.uploadingFiles === 'true') {
        event.preventDefault();
        return;
      }

      const groups = getUploadGroups(form);
      const missingGroups = groups.filter((group) => !isGroupComplete(group));

      if (!missingGroups.length) {
        syncFormState(form);
        return;
      }

      const missingWithoutFiles = missingGroups.filter((group) => !groupHasSelectedFile(group));
      if (missingWithoutFiles.length) {
        syncFormState(form);
        event.preventDefault();
        const firstInput = getGroupFileInput(missingWithoutFiles[0]);
        if (firstInput) firstInput.focus();
        return;
      }

      event.preventDefault();
      form.dataset.uploadingFiles = 'true';

      try {
        for (const group of missingGroups) {
          setUploadStatus(group, 'Saving file...', false);
          await uploadGroupFile(group);
        }

        window.updateRequiredCheckoutFields();
        form.dataset.allowCheckoutSubmit = 'true';
        form.requestSubmit(submitter);
      } catch (error) {
        const targetGroup = missingGroups.find((group) => !isGroupComplete(group)) || missingGroups[0];
        if (targetGroup) {
          setUploadStatus(targetGroup, error.message || 'Upload failed.', true);
        }
      } finally {
        form.dataset.uploadingFiles = 'false';
      }
    },
    true
  );

  document.addEventListener('DOMContentLoaded', () => {
    window.updateRequiredCheckoutFields();
  });

  window.updateRequiredCheckoutFields();
}

if (!customElements.get('cart-note')) {
  customElements.define(
    'cart-note',
    class CartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener(
          'input',
          debounce((event) => {
            const body = JSON.stringify({ note: event.target.value });
            fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } }).then(() =>
              CartPerformance.measureFromEvent('note-update:user-action', event)
            );
          }, ON_CHANGE_DEBOUNCE_TIMER)
        );
      }
    }
  );
}
