'use client';

import { Buffer } from 'buffer';
import type { Descriptor, Session, WebUsbTransport } from '@trezor/transport';

type ConnectResult<T> =
  | { success: true; payload: T }
  | { success: false; payload: { error: string; code?: string } };

type InitSettings = {
  manifest?: {
    email: string;
    appUrl: string;
  };
  debug?: boolean;
};

type UiRequestPayload =
  | { type: 'ui-request_pin'; payload?: { requestType?: number } }
  | { type: 'ui-request_passphrase'; payload?: { onDeviceAllowed: boolean } }
  | { type: 'ui-request_button'; payload?: { code?: number; name?: string } }
  | { type: 'ui-select_device'; payload: { devices: Descriptor[] } }
  | { type: 'ui-close_window' }
  | { type: 'ui-error'; payload: { message: string } }
  | { type: 'ui-invalid_pin'; payload?: { attemptsLeft?: number } }
  | { type: 'ui-invalid_passphrase' }
  | { type: 'ui-no_transport' }
  | { type: 'ui-request_word' };

type UiResponse =
  | { type: 'ui-receive_pin'; payload: { pin: string } }
  | { type: 'ui-receive_passphrase'; payload: { passphrase?: string; onDevice?: boolean } }
  | { type: 'ui-receive_device'; payload: { path: string } }
  | { type: 'ui-receive_word'; payload: { word: string } }
  | { type: 'ui-receive_confirmation'; payload: { confirmed: boolean } };

type PendingUi = {
  type: UiResponse['type'];
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
};

type Listener = (event: UiRequestPayload) => void;

class SimpleEmitter {
  private listeners = new Set<Listener>();

  on(listener: Listener) {
    this.listeners.add(listener);
  }

  off(listener: Listener) {
    this.listeners.delete(listener);
  }

  emit(event: UiRequestPayload) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

const HARDENED = 0x80000000;

function ensureBuffer() {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }
}

function parsePath(path: string): number[] {
  const cleaned = path.replace(/^m\//i, '');
  if (!cleaned) return [];
  return cleaned.split('/').map((segment) => {
    const hardened = segment.endsWith("'") || segment.endsWith('h');
    const value = Number.parseInt(segment.replace(/['h]/g, ''), 10);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid derivation path segment: ${segment}`);
    }
    return hardened ? value | HARDENED : value;
  });
}

class TrezorConnectLike {
  private settings: InitSettings = {};
  private initialized = false;
  private transport: WebUsbTransport | null = null;
  private session: Session | null = null;
  private descriptor: Descriptor | null = null;
  private features: any | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pendingUi: PendingUi | null = null;
  private emitter = new SimpleEmitter();
  private debug =
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_TREZOR_DEBUG === '1' ||
      process.env.NEXT_PUBLIC_TREZOR_DEBUG === 'true');

  private log(...args: any[]) {
    if (!this.debug && !this.settings.debug) return;
    // eslint-disable-next-line no-console
    console.log('[Trezor]', ...args);
  }

  on(listener: Listener) {
    this.emitter.on(listener);
  }

  off(listener: Listener) {
    this.emitter.off(listener);
  }

  manifest(data: InitSettings['manifest']) {
    this.settings.manifest = data;
  }

  async init(settings: InitSettings = {}): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Wrong environment');
    }

    if (this.initialized) return;
    ensureBuffer();

    this.settings = { ...this.settings, ...settings };
    if (settings.debug) {
      this.debug = true;
    }
    if (!this.settings.manifest) {
      throw new Error('Init_ManifestMissing');
    }

    const transportModule = await import(
      '@trezor/transport/lib/transports/webusb.browser'
    );
    const messages = (await import('@trezor/protobuf/messages.json')).default as Record<
      string,
      any
    >;

    this.transport = new transportModule.WebUsbTransport({
      messages,
      id: 'vault-bridge'
    });

    const initResult = await this.transport.init();
    if (!initResult.success) {
      throw new Error(initResult.error || 'Transport init failed');
    }

    const listenResult = this.transport.listen();
    if (!listenResult.success) {
      throw new Error(listenResult.error || 'Transport listen failed');
    }

    this.log('Transport initialized');
    this.initialized = true;
  }

  async dispose() {
    this.session = null;
    this.descriptor = null;
    this.features = null;
    this.initialized = false;
    this.pendingUi?.reject(new Error('Disposed'));
    this.pendingUi = null;
    this.transport?.stop();
    this.transport = null;
  }

  async requestWebUSBDevice(): Promise<void> {
    const usb = (navigator as any).usb;
    if (typeof navigator === 'undefined' || !usb) {
      throw new Error('WebUSB not supported');
    }
    const constants = await import('@trezor/transport/lib/constants');
    this.log('Requesting WebUSB device');
    await usb.requestDevice({
      filters: constants.TREZOR_USB_DESCRIPTORS
    });
    this.log('WebUSB device granted');
  }

  uiResponse(response: UiResponse) {
    if (!this.pendingUi) return;
    if (response.type !== this.pendingUi.type) return;
    this.log('UI response', response.type);
    this.pendingUi.resolve(response.payload);
    this.pendingUi = null;
  }

  cancel(error?: string) {
    if (this.pendingUi) {
      this.pendingUi.reject(new Error(error || 'Cancelled'));
      this.pendingUi = null;
    }
    if (this.transport && this.session) {
      try {
        (this.transport as any).releaseSync(this.session);
      } catch {
        // ignore
      }
      this.session = null;
    }
  }

  async solanaGetAddress(params: {
    path: string;
    showOnTrezor?: boolean;
  }): Promise<ConnectResult<{ address: string; path: string }>> {
    return this.enqueue(async () => {
      try {
        const response = await this.callWithUi('SolanaGetAddress', {
          address_n: parsePath(params.path),
          show_display: params.showOnTrezor ?? false
        });

        if (response.type !== 'SolanaAddress') {
          throw new Error(`Unexpected response: ${response.type}`);
        }

        return {
          success: true,
          payload: { address: response.message.address, path: params.path }
        };
      } catch (err: any) {
        return { success: false, payload: { error: err.message || 'Failed' } };
      }
    });
  }

  async solanaSignTransaction(params: {
    path: string;
    serializedTx: string;
  }): Promise<ConnectResult<{ signature: string }>> {
    return this.enqueue(async () => {
      try {
        const response = await this.callWithUi('SolanaSignTx', {
          address_n: parsePath(params.path),
          serialized_tx: Buffer.from(params.serializedTx, 'hex')
        });

        if (response.type !== 'SolanaTxSignature') {
          throw new Error(`Unexpected response: ${response.type}`);
        }

        const signatureHex = Buffer.from(response.message.signature).toString('hex');
        return { success: true, payload: { signature: signatureHex } };
      } catch (err: any) {
        return { success: false, payload: { error: err.message || 'Failed' } };
      }
    });
  }

  async getFeatures(): Promise<ConnectResult<any>> {
    return this.enqueue(async () => {
      try {
        const response = await this.callWithUi('GetFeatures', {});
        if (response.type !== 'Features') {
          throw new Error(`Unexpected response: ${response.type}`);
        }
        this.features = response.message;
        return { success: true, payload: response.message };
      } catch (err: any) {
        return { success: false, payload: { error: err.message || 'Failed' } };
      }
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async ensureSession(): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport missing');
    }
    if (this.session) return;

    const transport = this.transport as any;
    const enumerated = await transport.enumerate();
    if (!enumerated.success) {
      throw new Error(enumerated.error || 'Transport enumerate failed');
    }
    const descriptors = enumerated.payload;
    if (!descriptors.length) {
      this.emitUi({ type: 'ui-no_transport' });
      throw new Error('Transport_Missing');
    }
    this.log('Enumerated devices', descriptors.length);

    let descriptor = descriptors[0];
    if (descriptors.length > 1) {
      const chosen = (await this.waitForUi({
        type: 'ui-receive_device',
        request: {
          type: 'ui-select_device',
          payload: { devices: descriptors }
        }
      })) as { path: string };
      const found = descriptors.find((item: Descriptor) => item.path === chosen.path);
      if (found) {
        descriptor = found;
      }
    }

    const acquired = await transport.acquire({
      input: { path: descriptor.path, previous: descriptor.session ?? null }
    });
    if (!acquired.success) {
      throw new Error(acquired.error || 'Transport acquire failed');
    }
    this.session = acquired.payload;
    this.descriptor = descriptor;
    this.log('Session acquired', descriptor.path);

    this.transport.deviceEvents.on(descriptor.path, (event: any) => {
      this.log('Device event', event?.type);
      if (event.type === 'transport-device_disconnected') {
        this.session = null;
        this.descriptor = null;
        this.features = null;
        this.emitUi({ type: 'ui-no_transport' });
      }
    });

    try {
      const initResponse = await this.callWithUi('Initialize', {});
      if (initResponse.type === 'Features') {
        this.features = initResponse.message;
      }
    } catch {
      // Ignore initialize failures; subsequent calls will surface issues.
    }
  }

  private async callWithUi(
    name: string,
    data: Record<string, unknown>
  ): Promise<{ type: string; message: any }> {
    await this.ensureSession();
    if (!this.transport || !this.session) {
      throw new Error('Transport missing');
    }

    const transport = this.transport as any;
    let hadError = false;
    let retriedAfterFeatures = false;
    let suppressUiError = false;
    try {
      this.log('Call', name);
      let response = await transport.call({
        session: this.session,
        name,
        data
      });

      while (true) {
        if (!response.success) {
          throw new Error(response.error || 'Transport call failed');
        }

        const { type, message } = response.payload;
        this.log('Response', type);

        if (type === 'Features' && name !== 'GetFeatures') {
          this.features = message;
          if (retriedAfterFeatures) {
            throw new Error('Unexpected response: Features');
          }
          retriedAfterFeatures = true;
          response = await transport.call({
            session: this.session,
            name,
            data
          });
          continue;
        }

        if (type === 'Failure') {
          const errorMessage = message?.message || 'Device failure';
          if (message?.code === 7) {
            this.emitUi({ type: 'ui-invalid_pin' });
          }
          throw new Error(errorMessage);
        }

        if (type === 'ButtonRequest') {
          this.emitUi({
            type: 'ui-request_button',
            payload: { code: message?.code, name: message?.name }
          });
          this.log('ButtonRequest', message?.code);
          response = await transport.call({
            session: this.session,
            name: 'ButtonAck',
            data: {}
          });
          continue;
        }

        if (type === 'PinMatrixRequest') {
          this.log('PinMatrixRequest', message?.type);
          const pinPayload = (await this.waitForUi({
            type: 'ui-receive_pin',
            request: {
              type: 'ui-request_pin',
              payload: { requestType: message?.type }
            }
          })) as { pin: string };
          response = await transport.call({
            session: this.session,
            name: 'PinMatrixAck',
            data: { pin: pinPayload.pin }
          });
          continue;
        }

        if (type === 'PassphraseRequest') {
          const onDeviceFlag =
            typeof message?.on_device !== 'undefined'
              ? message?.on_device
              : message?._on_device;
          this.log('PassphraseRequest', onDeviceFlag);
          const passPayload = (await this.waitForUi({
            type: 'ui-receive_passphrase',
            request: {
              type: 'ui-request_passphrase',
              payload: { onDeviceAllowed: !!onDeviceFlag }
            }
          })) as { passphrase?: string; onDevice?: boolean };
          if (passPayload.onDevice) {
            this.log('PassphraseAck', 'on-device');
          } else {
            this.log(
              'PassphraseAck',
              `length=${passPayload.passphrase ? passPayload.passphrase.length : 0}`
            );
          }
          const ackData: Record<string, unknown> = {
            passphrase: passPayload.passphrase || ''
          };
          if (passPayload.onDevice) {
            ackData.on_device = true;
          }
          response = await transport.call({
            session: this.session,
            name: 'PassphraseAck',
            data: ackData
          });
          continue;
        }

        if (type === 'WordRequest') {
          this.log('WordRequest');
          const wordPayload = (await this.waitForUi({
            type: 'ui-receive_word',
            request: { type: 'ui-request_word' }
          })) as { word: string };
          response = await transport.call({
            session: this.session,
            name: 'WordAck',
            data: { word: wordPayload.word }
          });
          continue;
        }

        return { type, message };
      }
    } catch (error: any) {
      hadError = true;
      const message = error?.message || 'Trezor error';
      suppressUiError = name === 'SolanaGetAddress';
      if (!suppressUiError) {
        this.emitUi({
          type: 'ui-error',
          payload: { message }
        });
      } else {
        this.log('Suppressed error', message);
      }
      throw error;
    } finally {
      if (!hadError || suppressUiError) {
        this.emitUi({ type: 'ui-close_window' });
      }
    }
  }

  private emitUi(event: UiRequestPayload) {
    this.log('UI request', event.type);
    this.emitter.emit(event);
  }

  private waitForUi(params: {
    type: UiResponse['type'];
    request: UiRequestPayload;
  }): Promise<any> {
    if (this.pendingUi) {
      this.pendingUi.reject(new Error('UI already pending'));
      this.pendingUi = null;
    }
    this.emitUi(params.request);
    return new Promise((resolve, reject) => {
      this.pendingUi = {
        type: params.type,
        resolve,
        reject
      };
    });
  }
}

const TrezorConnect = new TrezorConnectLike();

export default TrezorConnect;
export { parsePath };
export type { UiRequestPayload, UiResponse, ConnectResult };
