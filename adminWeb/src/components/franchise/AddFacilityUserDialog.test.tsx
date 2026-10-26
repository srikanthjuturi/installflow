import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FacilityUserSource } from "@/services/facilityUsers";
import type { CreatedFacilityUser } from "@/types/parts";
import { AddFacilityUserDialog } from "./AddFacilityUserDialog";

/**
 * Task 13 §5.7 — the role picker is two cards, and with one option (a facility
 * admin may only add operators) it fills itself (hard rule 10).
 */

const created = (o: Partial<CreatedFacilityUser> = {}): CreatedFacilityUser => ({
  membershipId: "m1",
  userId: "u1",
  fullName: "Arjun Rao",
  email: "arjun@example.com",
  phone: "+919822011223",
  role: "facility_operator",
  isActive: true,
  createdAt: "2026-10-15T05:30:00Z",
  emailStatus: "sent",
  emailError: null,
  temporaryPassword: null,
  ...o,
});

function source(create = vi.fn().mockResolvedValue(created())): FacilityUserSource {
  return {
    key: "/test",
    list: vi.fn(),
    create,
    setActive: vi.fn(),
    reissuePassword: vi.fn(),
  };
}

function renderDialog(src: FacilityUserSource, roles: ("facility_admin" | "facility_operator")[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AddFacilityUserDialog open onOpenChange={vi.fn()} source={src} roles={roles} />
    </QueryClientProvider>
  );
}

async function fill() {
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Arjun Rao" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "arjun@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9822011223" } });
}

describe("AddFacilityUserDialog", () => {
  afterEach(cleanup);

  it("offers both roles to a franchisee admin, with neither chosen", () => {
    renderDialog(source(), ["facility_admin", "facility_operator"]);
    expect(screen.getByRole("radio", { name: /Facility Admin/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Facility Operator/ })).not.toBeChecked();
    expect(screen.getByText(/also adds and removes operators/)).toBeInTheDocument();
    expect(screen.getByText(/approves, issues and logs returns/)).toBeInTheDocument();
  });

  it("fills the only option itself for a facility admin (hard rule 10)", () => {
    renderDialog(source(), ["facility_operator"]);
    expect(screen.queryByRole("radio", { name: /Facility Admin/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Facility Operator/ })).toBeChecked();
  });

  it("posts the wire role and an E.164 phone", async () => {
    const create = vi.fn().mockResolvedValue(created());
    renderDialog(source(create), ["facility_operator"]);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      fullName: "Arjun Rao",
      email: "arjun@example.com",
      phone: "+919822011223",
      role: "facility_operator",
    });
  });

  it("shows the temporary password panel when the email failed — never a toast", async () => {
    const create = vi.fn().mockResolvedValue(
      created({
        emailStatus: "failed",
        emailError: "SMTP is down",
        temporaryPassword: "Tmp-Pass-123",
      })
    );
    renderDialog(source(create), ["facility_operator"]);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    expect(await screen.findByText("Added, but the email didn't send")).toBeInTheDocument();
    expect(screen.getByText("Tmp-Pass-123")).toBeInTheDocument();
    expect(screen.getByText("SMTP is down")).toBeInTheDocument();
  });
});
