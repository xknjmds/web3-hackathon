import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signPrepared, connectWallet, refreshWallet } from "@/lib/wallet";
import {
  isConnected,
  getNetworkDetails,
  getAddress,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  getNetworkDetails: vi.fn(),
  getAddress: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));
const address = `G${"A".repeat(55)}`;
const passphrase = "Test SDF Network ; September 2015";
const prepared = {
  network: "testnet" as const,
  networkPassphrase: passphrase,
  xdr: "unsigned",
  txHash: "a".repeat(64),
  expiresAt: new Date(Date.now() + 180_000).toISOString(),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isConnected).mockResolvedValue({ isConnected: true });
  vi.mocked(getAddress).mockResolvedValue({ address });
  vi.mocked(requestAccess).mockResolvedValue({ address });
  vi.mocked(getNetworkDetails).mockResolvedValue({
    network: "TESTNET",
    networkUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: passphrase,
  });
  vi.mocked(signTransaction).mockResolvedValue({
    signedTxXdr: "signed",
    signerAddress: address,
  });
});
it("connects and refreshes the selected Freighter customer", async () => {
  expect(await connectWallet()).toBe(address);
  expect(await refreshWallet()).toBe(address);
});
it("signs base64 XDR with the prepared passphrase and explicit customer address", async () => {
  expect(await signPrepared(prepared, address)).toBe("signed");
  expect(signTransaction).toHaveBeenCalledWith("unsigned", {
    networkPassphrase: passphrase,
    address,
  });
});
it("refuses mainnet before asking Freighter to sign", async () => {
  await expect(
    signPrepared({ ...prepared, network: "mainnet" }, address),
  ).rejects.toThrow("Testnet");
  expect(signTransaction).not.toHaveBeenCalled();
});
it("refuses a mismatched prepared passphrase", async () => {
  await expect(
    signPrepared(
      {
        ...prepared,
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      },
      address,
    ),
  ).rejects.toThrow("Testnet");
  expect(signTransaction).not.toHaveBeenCalled();
});
it("asks to switch Freighter when wallet network differs", async () => {
  vi.mocked(getNetworkDetails).mockResolvedValue({
    network: "PUBLIC",
    networkUrl: "https://horizon.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  });
  await expect(signPrepared(prepared, address)).rejects.toThrow(
    "Switch Freighter to Testnet",
  );
  expect(signTransaction).not.toHaveBeenCalled();
});
it("refuses stale customer selection and expired preparations", async () => {
  vi.mocked(getAddress).mockResolvedValue({ address: `G${"B".repeat(55)}` });
  await expect(signPrepared(prepared, address)).rejects.toThrow(
    "Wallet changed",
  );
  await expect(
    signPrepared(
      { ...prepared, expiresAt: new Date(0).toISOString() },
      address,
    ),
  ).rejects.toThrow("expired");
  expect(signTransaction).not.toHaveBeenCalled();
});
it("refuses an invalid expiry and unexpected signer", async () => {
  await expect(
    signPrepared({ ...prepared, expiresAt: "invalid" }, address),
  ).rejects.toThrow("expired");
  vi.mocked(signTransaction).mockResolvedValue({
    signedTxXdr: "signed",
    signerAddress: `G${"B".repeat(55)}`,
  });
  await expect(signPrepared(prepared, address)).rejects.toThrow(
    "different customer",
  );
});

afterEach(() => vi.useRealTimers());
it("reports missing Freighter without requesting access", async () => {
  vi.mocked(isConnected).mockResolvedValue({ isConnected: false });
  await expect(connectWallet()).rejects.toThrow("Install or enable Freighter");
  expect(requestAccess).not.toHaveBeenCalled();
});
it("bounds a missing extension that never answers its detection request", async () => {
  vi.useFakeTimers();
  vi.mocked(isConnected).mockReturnValue(new Promise(() => {}));
  const pending = expect(connectWallet()).rejects.toThrow(
    "Install or enable Freighter",
  );
  await vi.advanceTimersByTimeAsync(2000);
  await pending;
  expect(requestAccess).not.toHaveBeenCalled();
});
it("bounds an unanswered access prompt and lets the user retry", async () => {
  vi.useFakeTimers();
  vi.mocked(requestAccess).mockReturnValue(new Promise(() => {}));
  const pending = expect(connectWallet()).rejects.toThrow("Open the extension");
  await vi.advanceTimersByTimeAsync(60000);
  await pending;
});
