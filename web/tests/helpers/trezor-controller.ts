import WebSocket from 'ws';

export class TrezorTestController {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pending = new Map<number, (response: any) => void>();

  async connect(port = 9001) {
    if (this.ws) return;
    this.ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));
      let opened = false;
      let ready = false;
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connect timeout'));
      }, 10000);

      const tryResolve = () => {
        if (opened && ready) {
          clearTimeout(timeout);
          resolve();
        }
      };

      this.ws.on('open', () => {
        opened = true;
        tryResolve();
      });
      this.ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
      this.ws.on('message', (data: WebSocket.RawData) => {
        const response = JSON.parse(data.toString());
        if (response.type === 'client') {
          ready = true;
          tryResolve();
        }
        const resolver = this.pending.get(response.id);
        if (resolver) {
          resolver(response);
          this.pending.delete(response.id);
        }
      });
    });
  }

  async close() {
    if (!this.ws) return;
    await new Promise<void>((resolve) => {
      this.ws?.once('close', () => resolve());
      this.ws?.close();
    });
    this.ws = null;
  }

  private async send(type: string, params: Record<string, any> = {}) {
    if (!this.ws) throw new Error('WebSocket not connected');
    const id = ++this.messageId;

    const response = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${type} response`));
      }, 60000);

      this.pending.set(id, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });

      this.ws?.send(JSON.stringify({ type, id, ...params }));
    });

    if (response && response.success === false) {
      throw new Error(response.error || 'Trezor user env command failed');
    }

    return response;
  }

  startEmulator(model = 'T2T1', version = '2-main') {
    return this.send('emulator-start', { model, version, wipe: true });
  }

  stopEmulator() {
    return this.send('emulator-stop');
  }

  setupDevice(mnemonic = 'all all all all all all all all all all all all') {
    return this.send('emulator-setup', {
      mnemonic,
      pin: '',
      passphrase_protection: false,
      label: 'TestDevice'
    });
  }

  pressYes() {
    return this.send('emulator-press-yes');
  }

  pressNo() {
    return this.send('emulator-press-no');
  }

  input(value: string) {
    return this.send('emulator-input', { value });
  }

  startBridge() {
    return this.send('bridge-start');
  }

  stopBridge() {
    return this.send('bridge-stop');
  }
}
