"""Arranque en contenedor: socket doble de la API y chequeo del backend desde el dashboard."""

from __future__ import annotations

import socket

import pytest

from radar.cli import check_api, dual_stack_socket


def _connects(family: int, host: str, port: int) -> bool:
    with socket.socket(family, socket.SOCK_STREAM) as c:
        c.settimeout(2)
        return c.connect_ex((host, port)) == 0


@pytest.mark.skipif(not socket.has_ipv6, reason="sin IPv6 en esta máquina")
def test_dual_stack_socket_accepts_ipv4_and_ipv6():
    sock = dual_stack_socket(0)
    try:
        sock.listen(4)
        port = sock.getsockname()[1]
        assert _connects(socket.AF_INET6, "::1", port)
        assert _connects(socket.AF_INET, "127.0.0.1", port)
    finally:
        sock.close()


def test_check_api_reports_unreachable_backend_without_raising():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert check_api(f"http://127.0.0.1:{port}", attempts=2, wait_s=0) is False
