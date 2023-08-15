import { TotpCommand, FlipperCliEndOfCommand, FlipperVendorId, 
  FlipperProductId, TotpAskForPin, TotpCommandCancelled, 
  FlipperCliCommandNotFound, TotpEventNamePinRequested, TotpEventNameClose,
  TotpEventNameConnecting, TotpEventNameConnected } from './constants';
import delay from "delay";
import { SerialPort } from 'serialport';
import { readUntil, writeAndDrain } from './serial-port-extensions';
import { openAsync, closeAsync } from './serial-port-async';
import EventEmitter from 'node:events';
import { parseFromString } from './ascii-table-parse';
import escapeStringRegexp from 'escape-string-regexp';

async function getFlipperZeroDevice() {
  const serialDevices = await SerialPort.list();
  return serialDevices.find(p => p.vendorId == FlipperVendorId && p.productId == FlipperProductId);
}

async function waitForFlipperZeroDevice() {
  let flipperZeroDevice = null;
  while ((flipperZeroDevice = await getFlipperZeroDevice()) == null) {
    await delay(1000);
  }

  return flipperZeroDevice;
}

interface ExecuteCommandOptions {
  skipFirstLine: boolean,
  trimCommandEndSignature: boolean,
  trimEmptyLines: boolean,
  trimTerminalControlCommands: boolean,
  commandEndSign: string | RegExp
}

export class TotpAppClient extends EventEmitter {
  #serialPort: SerialPort | null = null;
  static #executeCommandDefaultOptions: ExecuteCommandOptions = {
    skipFirstLine: true,
    trimCommandEndSignature: true,
    trimEmptyLines: true,
    trimTerminalControlCommands: true,
    commandEndSign: FlipperCliEndOfCommand
  };

  constructor() {
    super();
    console.log('Constructor');
  }

  async #getSerialPort() {
    if (this.#serialPort == null) {
      let serialPort = null;

      do {
        this.emit(TotpEventNameConnecting, this);
        let flipperZeroDevice = await waitForFlipperZeroDevice();
        serialPort = new SerialPort({ path: flipperZeroDevice.path, baudRate: 115200, autoOpen: false });
        try {
          await openAsync(serialPort);
        } catch (e) {
          console.warn(e);
          serialPort = null;
          await delay(1000);
        }
        if (serialPort != null) {
          try {
            await readUntil(serialPort, FlipperCliEndOfCommand, 1000);
          } catch (e) {
            console.warn(e);
            await closeAsync(serialPort);
            serialPort = null;
            await delay(1000);
          }
        }
      } while (serialPort == null);

      serialPort.on('close', () => {
        this.#serialPort = null;
      });
      this.#serialPort = serialPort;
      this.emit(TotpEventNameConnected, this);
    }

    return this.#serialPort;
  }

  async #executeCommand(command: string, options: Partial<ExecuteCommandOptions> = {}) {
    const opts: ExecuteCommandOptions = Object.assign({}, TotpAppClient.#executeCommandDefaultOptions, options);
    let commandFound = false;
    let response;
    let commandEndSignForRegex;
    if (opts.commandEndSign instanceof RegExp) {
      commandEndSignForRegex = opts.commandEndSign.source;
    } else {
      commandEndSignForRegex = escapeStringRegexp(opts.commandEndSign);
    }
    const commandEndOutputSignRegex = new RegExp(`(${commandEndSignForRegex})|(${escapeStringRegexp(TotpAskForPin)})|(${escapeStringRegexp(TotpCommandCancelled)})`, 'gi');
    do {
      await writeAndDrain(await this.#getSerialPort(), command);
      if (opts.skipFirstLine) {
        await readUntil(await this.#getSerialPort(), '\r\n', 1000);
      }

      response = await readUntil(await this.#getSerialPort(), commandEndOutputSignRegex, 5000);

      commandFound = !!response && !response.includes(FlipperCliCommandNotFound);
      if (commandFound) {
        if (response?.includes(TotpAskForPin)) {
          this.emit(TotpEventNamePinRequested, this);
          response = await readUntil(await this.#getSerialPort(), commandEndOutputSignRegex);
        }
      } else {
        await delay(1000);
      }
    } while (!commandFound);

    if (!response || response.includes(TotpCommandCancelled)) {
      response = null;
    } else {
      if (opts.trimCommandEndSignature) {
        response = response.replace(opts.commandEndSign, '');
      }

      if (opts.trimTerminalControlCommands) {
        response = response.replace(/(\x1b\[(\d+m|A|2K))|(\b \b)\r?/g, '');
      }

      if (opts.trimEmptyLines) {
        response = response.replace(/^\s*\r?\n?$/gm, '');
      }
    }

    return response;
  }

  async waitForApp() {
    await this.#executeCommand(`${TotpCommand} ?\r`);
  }

  async waitForDevice() {
    if (!this.#serialPort) {
      await this.#getSerialPort();
    }
  }

  async listTokens() {
    let response = await this.#executeCommand(`${TotpCommand} ls\r`);
    return response ? parseFromString(response) : [];
  }

  async close() {
    if (this.#serialPort) {
      await closeAsync(this.#serialPort);
    }

    this.emit(TotpEventNameClose, this);
  }
}

export const SharedTotpAppClient = new TotpAppClient();