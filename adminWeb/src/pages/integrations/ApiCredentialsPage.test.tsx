import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCredential, CreatedApiCredential } from "@/types/integration";

/**
 * The secret appears in ONE place — the dialog that follows creating a
 * credential — and nowhere a list could redraw it from.
 */

const SECRET = "sk_live_THIS_IS_THE_ONE_TIME_SECRET";

const row = (o: Partial<ApiCredential> = {}): ApiCredential => ({
  id: "c1",
  vendorId: "v1",
  vendorName: "ABC Technologies",
  clientId: "abc_technologies_001",
  note: null,
  status: "Active",
  createdAt: "2026-10-01T05:30:00Z",
  lastUsedAt: null,
  revokedAt: null,
  replacesId: null,
  ...o,
});

const created = (o: Partial<CreatedApiCredential> = {}): CreatedApiCredential => ({
  credential: row({ id: "c2", clientId: "abc_technologies_002" }),
  clientSecret: SECRET,
  emailStatus: "sent",
  emailError: null,
  ...o,
});

const services = vi.hoisted(() => ({
  listApiCredentials: vi.fn(),
  createApiCredential: vi.fn(),
  replaceApiCredential: vi.fn(),
  revokeApiCredential: vi.fn(),
  listApiLogs: vi.fn(),
  listVendorOptions: vi.fn(),
}));

vi.mock("@/services/apiCredentials", () => ({
  listApiCredentials: services.listApiCredentials,
  createApiCredential: services.createApiCredential,
  replaceApiCredential: services.replaceApiCredential,
  revokeApiCredential: services.revokeApiCredential,
  listApiLogs: services.listApiLogs,
}));
vi.mock("@/services/vendors", async (original) => ({
  ...(await original<typeof import("@/services/vendors")>()),
  listVendorOptions: services.listVendorOptions,
}));

import ApiCredentialsPage from "./ApiCredentialsPage";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApiCredentialsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ApiCredentialsPage", () => {
  beforeEach(() => {
    services.listApiCredentials.mockResolvedValue([
      row(),
      row({
        id: "c0",
        clientId: "abc_technologies_000",
        status: "Revoked",
        revokedAt: "2026-10-02T05:30:00Z",
      }),
    ]);
    services.listVendorOptions.mockResolvedValue([
      { id: "v1", name: "ABC Technologies", brands: [], intakeChannels: ["API", "Manual"] },
      { id: "v2", name: "No API Co", brands: [], intakeChannels: ["Manual"] },
    ]);
    services.createApiCredential.mockResolvedValue(created());
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists credentials without any secret", async () => {
    renderPage();
    expect(await screen.findByText("abc_technologies_001")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk_live_/);
    expect(screen.queryByText(/Client Secret/i)).toBeNull();
  });

  it("offers Replace and Revoke on an Active row and neither on a Revoked one", async () => {
    renderPage();
    await screen.findByText("abc_technologies_001");
    expect(
      screen.getByRole("button", { name: /Replace the credential abc_technologies_001/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Revoke the credential abc_technologies_001/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Replace the credential abc_technologies_000/ })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Revoke the credential abc_technologies_000/ })
    ).toBeNull();
  });

  it("shows the secret once, in the dialog after generating, and never again", async () => {
    renderPage();
    await screen.findByText("abc_technologies_001");

    fireEvent.click(screen.getByRole("button", { name: /Generate credential/ }));
    const form = await screen.findByRole("dialog");
    // Only vendors with the API channel on are offered; the single one fills
    // itself, so the form can be submitted straight away.
    await waitFor(() =>
      expect(within(form).getByRole("combobox")).toHaveTextContent("ABC Technologies")
    );
    fireEvent.click(within(form).getByRole("button", { name: "Generate credential" }));

    expect(await screen.findByText("Credential generated")).toBeInTheDocument();
    expect(screen.getByTestId("client-secret")).toHaveTextContent(SECRET);
    expect(screen.getByTestId("client-id")).toHaveTextContent("abc_technologies_002");
    expect(
      screen.getByText("Copy the Client Secret now. It will not be shown again.")
    ).toBeInTheDocument();
    expect(screen.getByText(/emailed these credentials/)).toBeInTheDocument();
    // TanStack passes a context as a second argument; only the input matters.
    expect(services.createApiCredential.mock.calls[0][0]).toEqual({
      vendorId: "v1",
      note: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("Credential generated")).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("says this screen is the only copy when the email failed", async () => {
    services.createApiCredential.mockResolvedValue(
      created({ emailStatus: "failed", emailError: "mailbox full" })
    );
    renderPage();
    await screen.findByText("abc_technologies_001");
    fireEvent.click(screen.getByRole("button", { name: /Generate credential/ }));
    const form = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(form).getByRole("combobox")).toHaveTextContent("ABC Technologies")
    );
    fireEvent.click(within(form).getByRole("button", { name: "Generate credential" }));
    expect(await screen.findByText(/only copy/)).toBeInTheDocument();
    expect(screen.getByText(/mailbox full/)).toBeInTheDocument();
  });

  it("says where to switch the API channel on when no vendor has it", async () => {
    services.listVendorOptions.mockResolvedValue([
      { id: "v2", name: "No API Co", brands: [], intakeChannels: ["Manual"] },
    ]);
    renderPage();
    await screen.findByText("abc_technologies_001");
    fireEvent.click(screen.getByRole("button", { name: /Generate credential/ }));
    expect(
      await screen.findByText(/No vendor has the API channel switched on/)
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Generate credential" })
    ).toBeDisabled();
  });
});
