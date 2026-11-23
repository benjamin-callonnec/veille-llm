import pytest


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """No test may reach the network: the PDF download is the one place the reader could."""

    def refuse(*args, **kwargs):
        raise OSError("the network is disabled in tests")

    monkeypatch.setattr("veille_reader.pdf.urllib.request.build_opener", refuse)
