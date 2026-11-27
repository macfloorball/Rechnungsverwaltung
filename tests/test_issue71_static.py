"""Local update assets must be revalidated even when cached by Chromium."""
import asyncio
from backend.main import RevalidatedStaticFiles


def test_updated_assets_revalidate(tmp_path):
    asset = tmp_path / 'module.js'
    asset.write_text('export const version = 1;')
    static = RevalidatedStaticFiles(directory=tmp_path)

    async def check():
        scope = {'type': 'http', 'method': 'GET', 'headers': []}
        initial = await static.get_response('module.js', scope)
        assert initial.headers['cache-control'] == 'no-cache'
        cached = await static.get_response('module.js', {
            **scope, 'headers': [(b'if-none-match', initial.headers['etag'].encode())]})
        assert cached.status_code == 304
        assert cached.headers['cache-control'] == 'no-cache'
        asset.write_text('export const version = 222;')
        updated = await static.get_response('module.js', {
            **scope, 'headers': [(b'if-none-match', initial.headers['etag'].encode())]})
        assert updated.status_code == 200
        assert updated.headers['etag'] != initial.headers['etag']
    asyncio.run(check())
