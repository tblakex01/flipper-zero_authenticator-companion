<script lang="ts">
  import log from 'electron-log';
  import Fab, { Icon, Label } from '@smui/fab';
  import Textfield from '@smui/textfield';
  import Button, { Label as ButtonLabel } from '@smui/button';
  import Accordion, { Panel, Header, Content } from '@smui-extra/accordion';
  import Select, { Option } from '@smui/select';
  import Switch from '@smui/switch';
  import FormField from '@smui/form-field';
  import { Screenshots } from 'node-screenshots';
  import QrScanner from 'qr-scanner';
  import { GlobalPreloader } from '$stores/global-preloader';
  import { onDestroy, onMount } from 'svelte';
  import { TokenInfo } from '$models/token-info';
  import { TokenHashingAlgo, tokenHashingAlgoFromString } from '$models/token-hashing-algo';
  import { TokenLength, tokenLengthFromNumber } from '$models/token-length';
  import { TokenSecretEncoding } from '$models/token-secret-encoding';
  import { TokenAutomationFeature } from '$models/token-automation-feature';
  import { goto } from '$app/navigation';
  import { parse } from 'url-otpauth-ng';
  import { SharedTotpAppClient } from '$stores/totp-shared-client';
  import { CommonSnackbarType, GlobalCommonSnackbar } from '$stores/global-common-snackbar';
  import { page } from '$app/stores';
  import { blur } from 'svelte/transition';

  let abortController = new AbortController();
  let scannedData: string | null = null;
  let tokenInfo: TokenInfo | null | undefined;
  let availableTokenHashingAlgo: [string, TokenHashingAlgo][] = Object.entries(TokenHashingAlgo);
  let availableTokenLength: TokenLength[] = [TokenLength.SixDigits, TokenLength.EightDigits];
  let availableTokenSecretEncoding: [string, TokenSecretEncoding][] = Object.entries(TokenSecretEncoding);
  let availableTokenAutomationFeatures: [string, TokenAutomationFeature][] = [
    ['Type slower', TokenAutomationFeature.Slower],
    ['Press enter at the end', TokenAutomationFeature.Enter],
    ['Press tab at the end', TokenAutomationFeature.Tab],
  ];

  function formatAccountName(issuer: string | null | undefined, account: string | null | undefined) {
    if (issuer && account) return `${issuer} (${account})`;
    if (issuer) return issuer;
    return account || '';
  }

  async function onScanQrCodeClicked() {
    GlobalPreloader.show('Looking for QR code');
    // https://gist.github.com/kcramer/c6148fb906e116d84e4bde7b2ab56992
    scannedData = null;
    tokenInfo = null;
    for (const capture of Screenshots.all()) {
      const screenshot = await capture.capture();
      let scanResult: QrScanner.ScanResult | undefined;
      try {
        const blob = new Blob([screenshot]);
        scanResult = await QrScanner.scanImage(blob, { returnDetailedScanResult: true });
      } catch {
        /* empty */
      }

      if (scanResult) {
        scannedData = scanResult.data;
        break;
      }
    }

    if (scannedData) {
      try {
        const parsedTotpUri = parse(scannedData);
        tokenInfo = new TokenInfo({
          name: formatAccountName(parsedTotpUri.issuer, parsedTotpUri.account),
          length: tokenLengthFromNumber(parsedTotpUri.digits),
          secret: parsedTotpUri.key,
          duration: parsedTotpUri.period || 30,
          hashingAlgo: tokenHashingAlgoFromString(parsedTotpUri.algorithm),
        });
      } catch (e) {
        log.error(e);
      }
    }

    if (!tokenInfo) {
      GlobalCommonSnackbar.show('No valid QR code found', CommonSnackbarType.Warning);
    }

    GlobalPreloader.hide();
  }

  function onManualEntryClicked() {
    tokenInfo = new TokenInfo();
  }

  async function saveToken() {
    if (tokenInfo) {
      try {
        await SharedTotpAppClient.updateToken(tokenInfo, abortController.signal);
        await goto('/');
        GlobalCommonSnackbar.show(`Token ${tokenInfo.name} has been successfully added`, CommonSnackbarType.Success);
      } catch (e) {
        GlobalCommonSnackbar.show('An error occurred during token saving', CommonSnackbarType.Error);
        log.error(e);
      }
    }
  }

  async function loadTokenInfoIfEdit() {
    if ($page.params.id) {
      try {
        tokenInfo = await SharedTotpAppClient.getTokenDetails(Number($page.params.id), abortController.signal);
      } catch (e) {
        log.error(e);
        await goto('/');
        GlobalCommonSnackbar.show(`Unable to load token details`, CommonSnackbarType.Error);
      }
    }
  }

  onDestroy(() => abortController.abort());
  onMount(() => loadTokenInfoIfEdit());
</script>

<div class="container">
  {#if tokenInfo}
    <form class="token-info-form" on:submit={saveToken} transition:blur>
      <Textfield class="input-element" label="Name" type="text" variant="outlined" required bind:value={tokenInfo.name}
      ></Textfield>
      <Textfield
        class="input-element"
        label="Secret"
        type="password"
        variant="outlined"
        required={tokenInfo.id <= 0}
        bind:value={tokenInfo.secret}></Textfield>
      <Accordion multiple>
        <Panel>
          <Header>Additional settings</Header>
          <Content>
            <Select
              class="input-element"
              variant="outlined"
              bind:value={tokenInfo.hashingAlgo}
              label="Hashing algorithm">
              {#each availableTokenHashingAlgo as [name, algo]}
                <Option value={algo}>{name}</Option>
              {/each}
            </Select>
            <Select class="input-element" variant="outlined" bind:value={tokenInfo.length} label="Length">
              {#each availableTokenLength as len}
                <Option value={len}>{len} digits</Option>
              {/each}
            </Select>
            <Textfield
              class="input-element"
              label="Duration"
              type="number"
              min="15"
              max="255"
              variant="outlined"
              required
              bind:value={tokenInfo.duration}></Textfield>
            <Select
              class="input-element"
              variant="outlined"
              bind:value={tokenInfo.secretEncoding}
              label="Secret encoding">
              {#each availableTokenSecretEncoding as [name, enc]}
                <Option value={enc}>{name}</Option>
              {/each}
            </Select>
          </Content>
        </Panel>
        <Panel>
          <Header>Automation settings</Header>
          <Content>
            {#each availableTokenAutomationFeatures as [displayName, feature]}
              <div>
                <FormField>
                  <Switch bind:group={tokenInfo.automationFeatures} value={feature} />
                  <span slot="label">{displayName}</span>
                </FormField>
              </div>
            {/each}
          </Content>
        </Panel>
      </Accordion>
      <div class="action-controls">
        <Button class="save" variant="unelevated" type="submit">
          <ButtonLabel>Save</ButtonLabel>
        </Button>
        <Button class="cancel" type="reset" href="/">
          <ButtonLabel>Cancel</ButtonLabel>
        </Button>
      </div>
    </form>
  {:else}
    <div class="input-type-container">
      <Fab class="scan-qr-code" color="primary" on:click={onScanQrCodeClicked} extended>
        <Icon class="material-icons">qr_code_scanner</Icon>
        <Label>Scan QR Code</Label>
      </Fab>
      <p class="or-separator">OR</p>
      <Fab color="secondary" on:click={onManualEntryClicked} extended>
        <Icon class="material-icons">edit</Icon>
        <Label>Enter manually</Label>
      </Fab>
    </div>
  {/if}
</div>

<style lang="scss">
  .container {
    display: flex;
    height: max-content;
    min-height: 100%;

    .input-type-container {
      margin: 0 auto;
      display: flex;
      justify-content: center;
      flex-direction: column;
      width: 100%;
      max-width: 300px;

      .or-separator {
        margin: 20px 0 20px 0;
        text-align: center;
      }
    }

    .token-info-form {
      flex-basis: 100%;
      padding: 20px;

      :global(.input-element) {
        width: 100%;
        margin-bottom: 20px;
      }

      .action-controls {
        display: flex;
        justify-content: center;
        margin: 20px auto 0 auto;

        :global(.save) {
          margin-left: auto;
          margin-right: -70px;
        }

        :global(.cancel) {
          margin-left: auto;
        }
      }
    }
  }
</style>
