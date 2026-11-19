"""Run with the pinned Octop environment: python tests/octop-memory-native.py."""
import json
import runpy
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src/workbench'))
from octop_index import query_index

memory = runpy.run_path(str(ROOT / 'src/workbench/octop-bridge.py'))['memory']


class NativeMemory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='contractor-memory-', dir='/tmp')
        self.address = self.temp.name + '/index.sock'
        self.process = subprocess.Popen([sys.executable, str(ROOT / 'src/workbench/octop-bridge.py'),
                                         'serve-index', self.address], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(self.process.stdout.readline().strip(), b'Octop index ready')

    def tearDown(self):
        self.process.terminate()
        self.process.communicate(timeout=5)
        self.temp.cleanup()

    def test_global_recall_across_three_batches_and_request_isolation(self):
        entries = [{'id': f'entry-{i}', 'rev': 'a' * 64, 'text': f'unrelated source {i}'} for i in range(201)]
        entries[-1]['text'] = 'needle7492 门店推荐理由 280px 320px 360px'
        payload = {'query': 'needle7492', 'entries': entries}
        self.assertEqual(memory(payload), ['entry-200'])
        self.assertEqual(query_index({'socket': self.address, **payload}), ['entry-200'])
        self.assertEqual(query_index({'socket': self.address, **payload, 'entries': entries[:-1]}), [])
        self.assertEqual(query_index({'socket': self.address, **payload}), ['entry-200'])

    def test_health_and_reject_partial_stream(self):
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(3)
            client.connect(self.address)
            client.sendall(b'{"op":"health"}\n')
            self.assertEqual(json.loads(client.recv(1024)), {'ready': True})
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(3)
            client.connect(self.address)
            client.sendall(b'{"query":"needle7492","stream":true}\n'
                           b'{"entries":[{"id":"one","rev":"' + b'a' * 64 + b'","text":"needle7492"}]}\n')
            client.shutdown(socket.SHUT_WR)
            self.assertEqual(client.recv(1024), b'', 'partial streams must not return a partial search result')


if __name__ == '__main__':
    unittest.main()
