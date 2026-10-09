"""Run against a local fixture that supplies a staged release and simulated restart."""
import sys
from playwright.sync_api import sync_playwright

origin = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:38478'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin, wait_until='domcontentloaded')
    page.get_by_role('button', name='账号与自动运行', exact=True).click()
    page.wait_for_function("() => document.querySelector('#program-version').textContent.includes('0.2.0')")
    page.get_by_role('button', name='检查更新', exact=True).click()
    page.wait_for_function("() => !document.querySelector('#update-install').hidden")
    assert '0.3.0' in page.locator('#update-install').inner_text()
    assert page.locator('#update-install').is_enabled()
    page.screenshot(path='/tmp/creator-update-buttons.png', full_page=True)
    page.locator('#update-install').click()
    page.wait_for_function("() => document.querySelector('#program-version').textContent.includes('0.3.0')", timeout=10000)
    page.wait_for_function("() => !document.querySelector('#update-install') || document.querySelector('#update-install').hidden", timeout=10000)
    page.get_by_role('button', name='账号与自动运行', exact=True).click()
    assert '更新完成' in page.locator('#update-feedback').inner_text()
    assert not errors, errors
    page.set_viewport_size({'width': 360, 'height': 800})
    assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
    print('Update browser check passed: discovers a release, installs via the button, reloads the new version and preserves mobile layout.')
    browser.close()
