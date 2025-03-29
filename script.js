const chat = document.getElementById('chat');
let twitchChannel = localStorage.getItem('twitchChannel') || 'example'; // 初期値としてチャンネル名を設定
const oauthToken = 'XXXXXXXXXXXXXXXX'; // ここに取得したOAuthトークンを記入

// ユーザ辞書を格納するオブジェクト
let userDictionary = {};

// ユーザ辞書を取得する関数
async function fetchUserDictionary() {
    try {
        const response = await axios.get('userDictionary.json');
        userDictionary = response.data; // 辞書をオブジェクトに格納
    } catch (error) {
        console.error("ユーザ辞書の取得エラー:", error);
    }
}

// ページが読み込まれたときにユーザ辞書を取得
window.addEventListener('DOMContentLoaded', () => {
    fetchUserDictionary();
});

document.getElementById('themeSelect').addEventListener('change', function () {
    document.body.className = this.value; // 選択されたテーマのクラスをボディに設定
});

// テーマを適用する関数
function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme); // 選択したテーマを保存
}

// ページが読み込まれたときにテーマを取得
window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light'; // デフォルトはlight
    applyTheme(savedTheme);
});

// ドロップダウンメニューの変更をリッスン
const themeSelect = document.getElementById('themeSelect');
themeSelect.addEventListener('change', (event) => {
    applyTheme(event.target.value);
});

const speakerSelect = document.getElementById('speakerSelect'); // スピーカー用ドロップダウン
let selectedSpeakerId = 1; // デフォルトのスピーカーID

// スピーカー選択の変更時の処理
speakerSelect.addEventListener('change', (event) => {
    selectedSpeakerId = event.target.value;
    localStorage.setItem('selectedSpeakerId', selectedSpeakerId); // IDを保存
});

// スピーカー情報を取得する関数
async function fetchSpeakers() {
    try {
        const response = await axios.get('speakers.json');
        const speakers = response.data;

        // スピーカーごとに選択肢を作成
        speakers.forEach(speaker => {
            speaker.styles.forEach(style => {
                const option = document.createElement('option');
                option.value = style.id; // スタイルIDを設定
                option.textContent = `${speaker.name} - ${style.name}`; // スピーカー名とスタイル名を表示
                speakerSelect.appendChild(option);
            });
        });

        // 前回選択したスピーカーIDを取得
        const savedSpeakerId = localStorage.getItem('selectedSpeakerId');
        if (savedSpeakerId) {
            selectedSpeakerId = savedSpeakerId;
            speakerSelect.value = savedSpeakerId; // 保存したIDをセット
        } else if (speakers.length > 0 && speakers[0].styles.length > 0) {
            selectedSpeakerId = speakers[0].styles[0].id;
            speakerSelect.value = selectedSpeakerId; // デフォルトIDをセット
        }
    } catch (error) {
        console.error("スピーカー情報の取得エラー:", error);
    }
}

// スピーカー情報を取得してドロップダウンを作成
fetchSpeakers();

let socket;
const reconnectDelay = 2000; // 再接続までの遅延（ミリ秒）

function connect() {
    // WebSocket接続を作成
    socket = new WebSocket(`wss://irc-ws.chat.twitch.tv:443`);

    // 接続が開かれたときの処理
    socket.addEventListener('open', () => {
        console.log('Connected to Twitch chat');
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");//エモート情報を取得する
        socket.send(`PASS oauth:${oauthToken}`);
        socket.send(`NICK justinfan12345`); // 任意のユーザー名で接続
        socket.send(`JOIN #${twitchChannel}`); // 指定したチャンネルに参加
    });
    socket.addEventListener('message', (event) => {
        const data = event.data;
        console.log("Raw IRC Data:", data); // 受信データをログ表示
    
        if (data.includes('PRIVMSG')) {
            // メッセージ部分のみを取得
            const messageMatch = data.match(/PRIVMSG #[^ ]+ :(.*)/);
            if (!messageMatch) return;
    
            const messageText = messageMatch[1]; // メッセージのテキスト部分のみ取得
            const usernameMatch = data.match(/display-name=([^;]*)/);
            const username = usernameMatch ? usernameMatch[1] : "Unknown";
    
            // エモートを削除
            const { modifiedMessage, textForSpeech } = convertEmotesFromIRCMessage(data);
    
            // ユーザ辞書を適用
            let transformedMessage = applyUserDictionary(modifiedMessage);
            let transformedSpeechText = applyUserDictionary(textForSpeech); // 読み上げ用にも適用
    
            // 正しくメッセージを表示
            displayMessage(username, modifiedMessage);
    
            // 音声再生
            if (isPlaying) queueAudio(transformedSpeechText);  // 音声に変換後のテキストを渡す
        }
    });
// エモートを削除する関数
function convertEmotesFromIRCMessage(rawIRCMessage) {
    const emoteTagMatch = rawIRCMessage.match(/emotes=([^;]*)/);
    const emoteTag = emoteTagMatch ? emoteTagMatch[1] : null;

    // メッセージ部分の取得
    const messageMatch = rawIRCMessage.match(/PRIVMSG [^:]+ :(.*)/);
    if (!messageMatch) return { modifiedMessage: '', textForSpeech: '' }; // メッセージが見つからない場合は空文字を返す
    let messageText = messageMatch[1];

    console.log("Raw message:", messageText); // メッセージ内容のログ出力

    if (!emoteTag) {
        // エモートがない場合はそのまま返す
        return { modifiedMessage: messageText, textForSpeech: messageText };
    }

    // エモート情報を解析
    const emoteRanges = emoteTag
        .split('/')
        .map(entry => {
            const [id, positions] = entry.split(':');
            return positions ? positions.split(',').map(pos => {
                const [start, end] = pos.split('-').map(Number);
                return { id, start, end };
            }) : [];
        })
        .flat();

    console.log("Emote ranges:", emoteRanges); // エモート範囲のログ出力

    let modifiedMessage = "";
    let textForSpeech = "";  // 音声用テキスト
    let lastIndex = 0;

    emoteRanges.forEach(({ id, start, end }) => {
        modifiedMessage += messageText.slice(lastIndex, start); // エモート前の文字列
        modifiedMessage += `<img src="https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0" alt="emote" class="emote">`; // エモート画像を挿入
        textForSpeech += messageText.slice(lastIndex, start);  // 音声用のテキストはそのまま
        lastIndex = end + 1;
    });

    modifiedMessage += messageText.slice(lastIndex); // 残りのメッセージを追加
    textForSpeech += messageText.slice(lastIndex); // 音声用テキストにも追加

    // ここでエモートタグなしのテキストを音声合成に渡す
    return { modifiedMessage, textForSpeech };
}

 // 接続が切断されたときの処理
 socket.addEventListener('close', (event) => {
    console.log('Disconnected from Twitch chat', event.reason);
    console.log('Attempting to reconnect in 2 seconds...');
    // 再接続の試行
    setTimeout(connect, reconnectDelay);
});

// エラーが発生したときの処理
socket.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
});
}

// 初回接続を開始
connect();

// ユーザ辞書を使ってメッセージを変換する関数
function applyUserDictionary(message) {

    // エモート部分を一時的に除外するために、<img> タグを一時的に別のタグで囲む
    const emoteRegex = /<img [^>]*src="([^"]*)"[^>]*>/g;
    const emotes = [];
    let match;

    // エモートを一時的に保存し、メッセージから除外
    message = message.replace(emoteRegex, (match) => {
        emotes.push(match);
        return `<!--EMOTE-->${emotes.length - 1}<!--EMOTE-->`;
    });

    // ユーザー辞書を適用（テキスト部分のみ）
    for (const [key, value] of Object.entries(userDictionary)) {
        const regex = new RegExp(key, 'g');
        message = message.replace(regex, value);
    }

    // 変換後のメッセージにエモートを戻す
    message = message.replace(/<!--EMOTE-->(\d+)<!--EMOTE-->/g, (match, index) => {
        return emotes[index];
    });

    return message;
}
// メッセージを表示する関数
function displayMessage(username, message) {
    const msgElement = document.createElement('div');
    msgElement.innerHTML = `${username}: ${message}`;
    chat.appendChild(msgElement);
    chat.scrollTop = chat.scrollHeight; // スクロールを最新メッセージに合わせる
}

// 初期文字数制限をlocalStorageから取得、なければデフォルト値50
let maxCharacters = parseInt(localStorage.getItem('maxCharacters')) || 50;
const characterLimitInput = document.getElementById('characterLimit');

// 初期表示時にlocalStorageの値をUIに設定
characterLimitInput.value = maxCharacters;

// 入力値が変更されたらmaxCharactersを更新し、localStorageに保存
characterLimitInput.addEventListener('input', (event) => {
    const newLimit = parseInt(event.target.value, 10);
    if (!isNaN(newLimit) && newLimit > 0) {
        maxCharacters = newLimit;
        localStorage.setItem('maxCharacters', maxCharacters); // 値をlocalStorageに保存
    }
});

// 音量と速度のスライダーを取得
const volumeControl = document.getElementById('volumeControl');
const speedControl = document.getElementById('speedControl');

// 音量と速度の初期値をlocalStorageから取得
let volume = parseFloat(localStorage.getItem('volume')) || 1;
let speed = parseFloat(localStorage.getItem('speed')) || 1;

// スライダーの初期値を設定
volumeControl.value = volume;
speedControl.value = speed;

// 音量の変更時の処理
volumeControl.addEventListener('input', (event) => {
    volume = parseFloat(event.target.value);
    localStorage.setItem('volume', volume); // 値をlocalStorageに保存
});

// 速度の変更時の処理
speedControl.addEventListener('input', (event) => {
    speed = parseFloat(event.target.value);
    localStorage.setItem('speed', speed); // 値をlocalStorageに保存
});

// 音声再生管理
let isPlaying = false; // 音声再生の状態フラグ
let audioQueue = []; // 再生するメッセージのキュー

//音声再生ボタンのデフォルト設定
const playAudioButton = document.getElementById('playAudioButton');
playAudioButton.textContent = '音声再生スタート'; // ボタンの初期テキスト
playAudioButton.style.backgroundColor = 'blue'; // ボタンの初期色を青に設定

// 音声再生スタートボタンのクリックイベント
playAudioButton.addEventListener('click', () => {
    isPlaying = !isPlaying;

    if (isPlaying) {
        playAudioButton.textContent = '音声再生ストップ';
        playAudioButton.style.backgroundColor = 'red';
        playNextAudio(); // キューの再生を開始
    } else {
        playAudioButton.textContent = '音声再生スタート';
        playAudioButton.style.backgroundColor = 'blue';
        audioQueue = []; // キューをクリア
    }
});
// 音声合成を作成する関数 (メッセージをキューに追加)
async function queueAudio(text) {
    if (text.length > maxCharacters) {
        text = text.substring(0, maxCharacters) + '…以下略';
    }
    try {41
        const data = await createVoice(text);
        const audio = new Audio(URL.createObjectURL(data));
        audio.volume = volume;
        audio.playbackRate = speed;
        audioQueue.push(audio); // キューに追加
        if (isPlaying && audioQueue.length === 1) playNextAudio(); // 再生中であればキューの次を再生
    } catch (error) {
        console.error("音声合成エラー:", error);
    }
}

let isAudioPlaying = false; // 現在の音声が再生中かどうかを管理するフラグ

// キュー内の音声を再生する関数
function playNextAudio() {
    if (audioQueue.length > 0 && isPlaying && !isAudioPlaying) {
        const audio = audioQueue.shift();
        isAudioPlaying = true; // 音声が再生中であることを示す

        audio.play();
        audio.addEventListener('ended', () => {
            isAudioPlaying = false; // 音声が終了したら再生中フラグをリセット
            playNextAudio(); // 次の音声を再生
        });
    }
}

// 音声合成のクエリを生成する関数
async function createQuery(text) {
    const response = await axios.post(
        `http://localhost:50021/audio_query?speaker=${selectedSpeakerId}&text=${encodeURIComponent(text)}`
    );
    return response.data;
}

// 音声を合成する関数
async function createVoice(text) {
    const query = await createQuery(text);
    const response = await axios.post(
        `http://localhost:50021/synthesis?speaker=${selectedSpeakerId}`,
        query,
        { responseType: "blob" }
    );
    return response.data;
}

// チャンネル名を設定する処理
const channelInput = document.getElementById('channelInput');
const setChannelButton = document.getElementById('setChannelButton');

channelInput.value = localStorage.getItem('twitchChannel') || '';

setChannelButton.addEventListener('click', () => {
    const inputChannel = channelInput.value.trim();
    if (inputChannel) {
        twitchChannel = inputChannel;
        localStorage.setItem('twitchChannel', twitchChannel);
        console.log(`Twitch チャンネルが設定されました: ${twitchChannel}`);

        // タブを更新する
        location.reload(); // ページをリロード
    }
});
