"""Playwright E2E test: Discovery Hub with Gemini key."""
import sys, time, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

from playwright.sync_api import sync_playwright

GEMINI_KEY = os.getenv('Gemini_API_KEY') or os.getenv('IMAGE_API_KEY', '')
PASSWORD = os.getenv('管理者パスワード', '')
BASE_URL = 'https://insight-studio-chi.vercel.app'

api_log = []

def dismiss_modal(page):
    for _ in range(5):
        try:
            overlay = page.query_selector('.fixed.inset-0')
            if not overlay or not overlay.is_visible():
                break
            for selector in [
                'button:has-text("閉じる")', 'button:has-text("スキップ")',
                'button:has-text("Skip")', 'button:has-text("Close")',
                'button:has-text("次へ")', 'button:has-text("完了")',
                '[aria-label="Close"]',
            ]:
                b = page.query_selector(selector)
                if b and b.is_visible():
                    b.click()
                    time.sleep(0.5)
                    break
            else:
                page.keyboard.press('Escape')
                time.sleep(0.5)
        except Exception:
            break

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=200)
        page = browser.new_page()

        def on_response(resp):
            if '/api/discovery' in resp.url or '/api/ml' in resp.url:
                try:
                    api_log.append({'url': resp.url, 'status': resp.status, 'body': resp.text()[:400]})
                except Exception:
                    pass
        page.on('response', on_response)

        # --- Login ---
        page.goto(f'{BASE_URL}/login', timeout=30000)
        page.wait_for_load_state('domcontentloaded')
        time.sleep(1)
        pw_inp = page.query_selector('input[type=password]')
        if pw_inp:
            pw_inp.fill(PASSWORD)
        sub = page.query_selector('button[type=submit]')
        if sub:
            sub.click()
            page.wait_for_url(lambda u: 'login' not in u, timeout=12000)
        print('Login OK:', page.url)

        # --- Set Gemini key in localStorage ---
        if GEMINI_KEY:
            page.evaluate(f"localStorage.setItem('is_gemini_key', '{GEMINI_KEY}')")
            stored = page.evaluate("localStorage.getItem('is_gemini_key') || ''")
            print(f'Gemini key in localStorage: {stored[:10]}...')
        else:
            print('WARNING: No Gemini key available')

        # --- Discovery Hub ---
        page.goto(f'{BASE_URL}/discovery', wait_until='networkidle', timeout=30000)
        time.sleep(1.5)
        dismiss_modal(page)
        time.sleep(0.5)
        page.screenshot(path='C:/tmp/discovery_loaded.png')

        # Debug: list all buttons and inputs
        btn_list = page.evaluate("""
            Array.from(document.querySelectorAll('button')).map(b => ({
                text: b.innerText.trim().slice(0,50),
                disabled: b.disabled,
                cls: b.className.slice(0,40)
            }))
        """)
        print('Buttons on page:')
        for b in btn_list:
            print(f'  [{("disabled" if b["disabled"] else "enabled")}] {b["text"]!r}  cls={b["cls"]!r}')

        inp_list = page.evaluate("""
            Array.from(document.querySelectorAll('input')).map(i => ({
                ph: i.placeholder, type: i.type, val: i.value.slice(0,20)
            }))
        """)
        print('Inputs on page:')
        for i in inp_list:
            print(f'  type={i["type"]} ph={i["ph"]!r} val={i["val"]!r}')

        # Check sidebar indicator
        body_initial = page.inner_text('body')
        if 'Gemini で利用可' in body_initial:
            print('OK: Gemini indicator visible')
        elif 'Gemini' in body_initial:
            print('OK: Gemini visible on page')
        if 'サポートしていません' in body_initial:
            print('NG: Old rejection error visible!')

        # --- Set URL via native React event ---
        target_url = 'https://www.petabit.co.jp/'
        set_ok = page.evaluate(f"""
            (function() {{
                var inp = document.querySelector('input[placeholder*="競合"]') ||
                          document.querySelector('input[placeholder*="URL"]');
                if (!inp) return false;
                var setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, '{target_url}');
                inp.dispatchEvent(new Event('input', {{bubbles:true}}));
                inp.dispatchEvent(new Event('change', {{bubbles:true}}));
                return inp.value;
            }})()
        """)
        print(f'URL set result: {set_ok!r}')
        time.sleep(0.8)

        # Re-check button state after URL set
        btn_state = page.evaluate("""
            (function() {
                var b = document.querySelector('button.button-primary');
                if (!b) return null;
                return {text: b.innerText.trim().slice(0,40), disabled: b.disabled};
            })()
        """)
        print(f'Submit button state: {btn_state}')

        # --- Click the submit button ---
        if btn_state and not btn_state.get('disabled'):
            page.evaluate("document.querySelector('button.button-primary').click()")
            print('Discovery button clicked, waiting 25s...')
        else:
            print(f'Button not clickable ({btn_state}), trying anyway...')
            page.evaluate("document.querySelector('button.button-primary')?.click()")
            print('Clicked anyway...')

        time.sleep(5)
        page.screenshot(path='C:/tmp/discovery_5s.png')
        time.sleep(10)
        page.screenshot(path='C:/tmp/discovery_15s.png')
        time.sleep(10)
        page.screenshot(path='C:/tmp/discovery_25s.png')

        body_after = page.inner_text('body')
        if 'サポートしていません' in body_after:
            print('NG: Gemini rejection error appeared!')
        elif 'cannot import' in body_after or 'GoogleSearchRetrieval' in body_after:
            print('NG: SDK import error still present!')
        elif '422' in body_after:
            print('NG: 422 error appeared')
        elif '429' in body_after or 'RESOURCE_EXHAUSTED' in body_after:
            print('OK (rate limit): 429 => Gemini key WAS used for search ✓')
        elif 'エラー' in body_after or ('error' in body_after.lower() and 'stage=' in body_after):
            error_parts = [ln for ln in body_after.split('\n') if 'エラー' in ln or 'stage=' in ln]
            print('Error on page:', '\n'.join(error_parts[:5]))
        elif any(kw in body_after for kw in ['競合', '検索結果', '発見', 'petabit', '.co.jp']):
            # Some results appeared
            result_lines = [ln for ln in body_after.split('\n') if '.co.jp' in ln or '.com' in ln]
            print(f'OK: Possible results found! ({len(result_lines)} URL lines)')
            for ln in result_lines[:5]:
                print(f'  {ln}')
        else:
            print('Status after 25s (first 400 chars):')
            print(body_after[:400])

        page.screenshot(path='C:/tmp/discovery_final.png')

        print('\n--- API Log ---')
        for entry in api_log[:8]:
            print(f'{entry["status"]} {entry["url"][-70:]}')
            body_snippet = entry['body']
            if 'サポートしていません' in body_snippet:
                print('  NG: rejection in response')
            elif 'cannot import' in body_snippet or 'GoogleSearchRetrieval' in body_snippet:
                print('  NG: SDK import error!')
            elif 'error' in body_snippet.lower() or 'detail' in body_snippet:
                print(f'  body: {body_snippet[:200]}')
            else:
                print(f'  body: {body_snippet[:100]}')

        browser.close()

run()
