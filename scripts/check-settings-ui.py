"""Exercise settings feedback in a real browser without accessing any platform."""
import sys
import subprocess
from playwright.sync_api import sync_playwright

origin = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:38476'
test_token = 'ui-check-token-not-a-real-credential'
def static_asset(body, mime):
    def handle(route):
        route.fulfill(body=body, content_type=mime)
    return handle

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    if '--baseline' in sys.argv:
        for name, content_type in [('index.html', 'text/html'), ('app.js', 'text/javascript'), ('styles.css', 'text/css')]:
            content = subprocess.run(['git', 'show', 'HEAD:public/' + name], check=True, capture_output=True).stdout
            url = origin + ('/' if name == 'index.html' else '/' + name)
            page.route(url, static_asset(content, content_type))
    page.goto(origin, wait_until='domcontentloaded')
    page.wait_for_function("() => document.querySelector('#links').children.length===3")
    page.get_by_role('button', name='账号与自动运行', exact=True).click()
    page.locator('#browser-token').fill('PLAYWRIGHT_MCP_EXTENSION_TOKEN=' + test_token)
    page.get_by_role('button', name='保存设置', exact=True).click()
    page.wait_for_function("() => document.querySelector('#browser-token').value===''", timeout=5000)
    result = page.evaluate("() => ({ feedback:document.querySelector('#settings-feedback')?.innerText || '', tokenState:document.querySelector('#browser-token-state')?.innerText || '', button:document.querySelector('#settings-save')?.innerText || '' })")
    assert '设置已保存' in result['feedback'], 'Saving clears the token but leaves no confirmation beside the save button'
    assert '已保存' in result['tokenState'], 'No persistent saved-token status is visible'
    assert '已保存' in result['button']
    assert page.locator('#settings-feedback').is_visible()
    page.wait_for_function("() => { const box = document.querySelector('#settings-feedback').getBoundingClientRect(); return box.y >= 0 && box.y < innerHeight; }", timeout=5000)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function("() => document.querySelector('#links').children.length===3")
    page.get_by_role('button', name='账号与自动运行', exact=True).click()
    assert '已保存' in page.locator('#browser-token-state').inner_text(), 'Saved state disappears on reload'
    assert page.locator('#browser-token').input_value() == ''
    assert test_token not in page.locator('body').inner_text()
    assert test_token not in page.request.get(origin + '/api/status').text()
    page.locator('#browser-token').fill('invalid token with spaces')
    page.get_by_role('button', name='保存设置', exact=True).click()
    page.wait_for_function("() => document.querySelector('#settings-feedback').textContent.includes('未保存')")
    assert page.locator('#browser-token').input_value() == 'invalid token with spaces'
    print('Browser settings check passed: inline confirmation, retained saved state, hidden token and visible failure.')
    browser.close()
