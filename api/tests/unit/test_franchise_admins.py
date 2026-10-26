"""Pins `blocks_last_admin` (03 §6): the one pure rule standing behind R3's
409 `FRANCHISEE_LAST_ADMIN` — a non-home franchisee whose only active admin is
the one being deactivated cannot lose them. The home franchisee is exempt:
its deactivation is refused earlier and separately. Pure, no database."""

import pytest

from app.core.franchise_logins import blocks_last_admin


@pytest.mark.parametrize("count", [0, 1])
def test_last_active_admin_refused(count: int) -> None:
    assert blocks_last_admin(
        is_home=False, target_is_active=True, active_admin_count=count
    ) is True


@pytest.mark.parametrize("count", [2, 3])
def test_second_and_third_admin_can_deactivate(count: int) -> None:
    assert blocks_last_admin(
        is_home=False, target_is_active=True, active_admin_count=count
    ) is False


@pytest.mark.parametrize("count", [0, 1, 2, 3])
def test_home_franchisee_never_blocked(count: int) -> None:
    assert blocks_last_admin(
        is_home=True, target_is_active=True, active_admin_count=count
    ) is False


def test_already_inactive_target_is_never_blocked() -> None:
    assert blocks_last_admin(
        is_home=False, target_is_active=False, active_admin_count=1
    ) is False


@pytest.mark.parametrize("count", [0, 1, 2, 3])
def test_home_exemption_applies_even_when_target_inactive(count: int) -> None:
    assert blocks_last_admin(
        is_home=True, target_is_active=False, active_admin_count=count
    ) is False


def test_count_zero_with_active_target_fails_closed() -> None:
    # Nothing counts as active, yet deactivating an active admin is still
    # refused — a count nobody can vouch for must not open the door.
    assert blocks_last_admin(
        is_home=False, target_is_active=True, active_admin_count=0
    ) is True


@pytest.mark.parametrize("is_home", [True, False])
@pytest.mark.parametrize("target_is_active", [True, False])
@pytest.mark.parametrize("count", [0, 1, 2, 3])
def test_table(is_home: bool, target_is_active: bool, count: int) -> None:
    assert blocks_last_admin(
        is_home=is_home, target_is_active=target_is_active, active_admin_count=count
    ) == (not is_home and target_is_active and count <= 1)