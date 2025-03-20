import http.server
import socketserver
import webbrowser
import os
import time
import threading

# サーバー設定
PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# カスタムHTTPサーバー
class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

# サーバーの開始
def start_server():
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        httpd.allow_reuse_address = True  # アドレス再利用を許可
        print(f"Serving at http://localhost:{PORT}/index.html")

        # ブラウザを開く（少し待機）
        time.sleep(1)
        webbrowser.open(f"http://localhost:{PORT}/index.html")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down the server...")
            httpd.server_close()

# サーバーを別スレッドで実行
if __name__ == "__main__":
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    try:
        while True:
            time.sleep(1)  # メインスレッドを維持
    except KeyboardInterrupt:
        print("\nServer terminated.")
