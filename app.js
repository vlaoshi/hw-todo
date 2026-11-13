/* =========================================================
   다마고치 투두 - app.js
   ---------------------------------------------------------
   구성 순서
   1. 게임 설정 (XP 규칙, 진화 단계, 픽셀 그림)
   2. 대사 모음
   0. Firebase 연결
   3. 저장소 계층 (Firestore 저장소 + 체험 모드용 localStorage 저장소)
   4. 로그인 계층 (아이디 로그인 / 로그인 없이 체험)
   5. 앱 상태(state)
   6. 화면 요소(DOM) 찾기
   7. 픽셀 캐릭터 그리기
   8. 다마고치 반응 (말풍선, 애니메이션, 폭죽)
   9. 8비트 효과음
   10. XP와 진화 처리
   10-1. 미니 다마고치 & 완료 카운트다운
   11. 할 일 기능 (추가 / 완료 / 수정 / 삭제 / 초기화)
   11-1. 날짜 기능 (날짜 이동 / 넘기기 / 접속 시 지난 일 가져오기)
   12. 화면 다시 그리기 (render)
   13. 이벤트 연결
   14. 앱 시작 & 로그인 화면
   ---------------------------------------------------------
   핵심 원칙
   - 화면은 항상 state(앱 상태)를 보고 그려요.
   - 데이터를 바꾸면: state 변경 → 화면 다시 그리기 → 저장소에 저장
     (화면부터 바꾸고 저장은 뒤에서 하므로 Firebase처럼 느린 저장소에서도 앱이 빠르게 느껴져요)
   ---------------------------------------------------------
   ※ 이 파일은 'ES 모듈'이에요. (index.html에서 type="module"로 불러와요)
     파일을 더블클릭해서 열면 동작하지 않으니 VS Code Live Server 같은 로컬 서버로 열어 주세요.
   ========================================================= */

/* =========================================================
   0. Firebase 연결
   ---------------------------------------------------------
   Firebase 콘솔에서 받은 연결 정보예요.
   apiKey는 원래 웹페이지에 공개되는 값이라 코드에 있어도 괜찮아요.
   대신 '누가 어떤 데이터를 읽고 쓸 수 있는지'는 Firestore 보안 규칙으로 꼭 막아야 해요. (3번 아래 참고)

   [Firebase 콘솔에서 한 번만 해 둘 설정]
   1) Authentication → 시작하기 → 로그인 방법 → '이메일/비밀번호' 사용 설정
      (아이디 로그인은 내부적으로 이메일/비밀번호 방식을 써요)
   2) Firestore Database → 데이터베이스 만들기 (ID는 (default), 위치는 서울 추천)
   3) Firestore Database → 규칙 탭에 아래 보안 규칙 붙여넣고 '게시'
   ========================================================= */

// Firebase 기능 불러오기 (콘솔에서 안내한 13.3.0 버전으로 모두 맞춰요)
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  writeBatch,
  increment,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";

// 내 Firebase 프로젝트 연결 정보
const firebaseConfig = {
  apiKey: "AIzaSyDKv5yBZIfs0CCkufgIBnqnJ94vyOOaKEY",
  authDomain: "hw-todo-7efc9.firebaseapp.com",
  projectId: "hw-todo-7efc9",
  storageBucket: "hw-todo-7efc9.firebasestorage.app",
  messagingSenderId: "582599341606",
  appId: "1:582599341606:web:9c2588e1ea90676fca98e7",
  measurementId: "G-T7F7KB0BVL",
  databaseURL: "https://hw-todo-7efc9-default-rtdb.firebaseio.com/",
};

// Firebase 시작
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp); // 데이터베이스(Firestore)
const auth = getAuth(firebaseApp);    // 로그인(Authentication)

/*
  ※ 개인정보 보호를 위해 방문 통계(Google Analytics)는 일부러 켜지 않았어요.
    Analytics는 방문자의 쿠키, 대략적인 위치, 기기 정보 등을 수집해요.
    (measurementId는 Analytics용 값이라 지금은 쓰이지 않아요)
*/

/* =========================================================
   1. 게임 설정
   ========================================================= */

// XP 규칙: 숫자만 바꾸면 게임 밸런스가 바뀌어요
const XP_RULES = {
  COMPLETE: 20,  // 할 일 완료 시 +20
  UNCHECK: -20,  // 완료 해제 시 -20 (회수)
  GIVE_UP: -10,  // 미완료 할 일 삭제(포기) 시 -10
  CARRY: -5,     // 할 일을 다음 날(또는 오늘)로 넘길 때마다 -5
  DUE_BONUS: 5,  // 마감일 당일까지 완료하면 보너스 +5 (해제하면 함께 회수)
};

// 같은 할 일을 이 횟수 이상 넘기면 다마고치가 잔소리를 해요.
const CARRY_NAG_COUNT = 3;

// '오늘 못 한 일 + 마감 지난 일'이 이 개수 이상이면 '다크서클/배고픔' 상태
const TIRED_THRESHOLD = 5;

// 할 일 글자 수 제한 (index.html의 maxlength와 같게)
const MAX_TEXT_LENGTH = 60;

// 게임기가 안 보일 때 완료하면 몇 초 기다렸다가 게임기 화면으로 올라갈지
const COUNTDOWN_SECONDS = 3;

/*
  픽셀 그림 읽는 법
  - 한 줄은 16글자, 모두 16줄 = 16×16 픽셀 그림이에요.
  - 글자 하나가 픽셀 한 칸이고, 글자마다 색이 정해져 있어요.
    '.' 투명   'k' 테두리   'b' 몸 색   'l' 몸 밝은 부분   'w' 흰색/배
    'p' 볼터치  'd' 다크서클  'r' 빨강    'g' 금색   'c' 망토   's' 반짝이
  - 얼굴(눈, 입)은 따로 그려서 face 위치(x, y)에 덧붙여요. 그래서 표정만 바꿀 수 있어요.
*/

// 모든 단계가 함께 쓰는 공통 색
const COMMON_PALETTE = {
  k: "#5b4a6b", // 테두리 (진한 보라 회색)
  w: "#ffffff",
  p: "#ffb3c6", // 볼터치
  d: "#8e7cc3", // 다크서클
  r: "#ff6b8b",
  g: "#ffd166",
  s: "#fff3a3",
};

// 진화 5단계 정보
const STAGES = [
  {
    level: 1,
    name: "알",
    minXp: 0,
    face: { x: 4, y: 5 }, // 얼굴을 붙일 위치 (왼쪽 위 기준)
    palette: { w: "#fff6e0", l: "#ffffff", b: "#ffc8dd" },
    sprite: [
      "................",
      "......kkkk......",
      "....kkwwwwkk....",
      "...kwwwwwwwwk...",
      "...kwlwwwwwwk...",
      "..kwlwwwwwwwwk..",
      "..kwwwwwwwwwwk..",
      "..kwwwwwwwwwwk..",
      "..kwwwwwwwwwwk..",
      "..kwwwwwwwwwwk..",
      "..kbwbwbwbwbwk..",
      "..kwbwbwbwbwbk..",
      "...kwwwwwwwwk...",
      "....kkwwwwkk....",
      "......kkkk......",
      "................",
    ],
  },
  {
    level: 2,
    name: "아기",
    minXp: 40,
    face: { x: 4, y: 6 },
    palette: { b: "#ffe39a", l: "#fff6cf" },
    sprite: [
      "................",
      "................",
      "................",
      ".....kkkkkk.....",
      "....kbbbbbbk....",
      "...kbllbbbbbk...",
      "..kblbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "...kbbbbbbbbk...",
      "....kkkkkkkk....",
      ".....kk..kk.....",
      "................",
      "................",
    ],
  },
  {
    level: 3,
    name: "청소년",
    minXp: 100,
    face: { x: 4, y: 5 },
    palette: { b: "#a8e6cf", l: "#d8f8ea" },
    sprite: [
      "....k......k....",
      ".....k....k.....",
      ".....kkkkkk.....",
      "....kbbbbbbk....",
      "...kbbbbbbbbk...",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      ".kkbbbbbbbbbbkk.",
      "kbkbbbbbbbbbbkbk",
      ".k.kbbbbbbbbk.k.",
      "....kkkkkkkk....",
      "....kbk..kbk....",
      "....kkk..kkk....",
    ],
  },
  {
    level: 4,
    name: "어른",
    minXp: 180,
    face: { x: 4, y: 4 },
    palette: { b: "#ffb5a7", l: "#ffd9d0", w: "#fff1ec" },
    sprite: [
      "..kk........kk..",
      "..kbk......kbk..",
      "..kbbkkkkkkbbk..",
      "..kbbbbbbbbbbk..",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      "kkbbbwwwwwwbbbkk",
      "kbkbwwwwwwwwbkbk",
      ".k.kbwwwwwwbk.k.",
      "...kkbbbbbbkk...",
      "...kbbk..kbbk...",
      "...kkkk..kkkk...",
    ],
  },
  {
    level: 5,
    name: "전설의 갓생 다마고치",
    minXp: 280,
    face: { x: 4, y: 5 },
    palette: { b: "#cdb4db", l: "#eadcf3", c: "#ff8fab" },
    sprite: [
      "s...g..gg..g..s.",
      "....gggggggg....",
      "....grggggrg....",
      "...kkkkkkkkkk...",
      "..kbbbbbbbbbbk..",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.",
      "kckbbbbbbbbbbkck",
      "kcckbbbbbbbbkcck",
      "kccckbbbbbbkccck",
      ".kkkkbbbbbbkkkk.",
      "....kbbk..kbbk..",
      "s...kkkk..kkkk.s",
    ],
  },
];

// 표정(얼굴) 그림: 가로 8칸 × 세로 5칸. '.'은 몸 색이 그대로 보여요.
const FACES = {
  // 보통
  normal: [
    ".k....k.",
    ".k....k.",
    "p......p",
    "........",
    "...kk...",
  ],
  // 기쁨: ^ ^ 눈 + 웃는 입
  happy: [
    ".k....k.",
    "k.k..k.k",
    "p......p",
    "..k..k..",
    "...kk...",
  ],
  // 냠냠: 입을 크게 벌림
  eating: [
    ".k....k.",
    "k.k..k.k",
    "p......p",
    "..kkkk..",
    "..krrk..",
  ],
  // 충격: 동그랗게 커진 눈 + 소리치는 입
  shocked: [
    "kk....kk",
    "kk....kk",
    "........",
    "..kkkk..",
    "..krrk..",
  ],
  // 다크서클/배고픔: 반쯤 감긴 눈 + 다크서클 + 시무룩한 입
  tired: [
    "........",
    "kkk..kkk",
    "ddd..ddd",
    "...kk...",
    "..k..k..",
  ],
};

// 완료할 때 먹는 음식들
const FOODS = ["🍎", "🍰", "🍙", "🍩", "🍓", "🍪"];

// 폭죽 색종이 색
const CONFETTI_COLORS = ["#ffc8dd", "#cdb4db", "#a8e6cf", "#ffe5a3", "#bde0fe", "#ff8fab"];

/* =========================================================
   2. 대사 모음 (랜덤으로 하나씩 골라 말풍선에 띄워요)
   ========================================================= */
const MESSAGES = {
  // 할 일 완료 칭찬
  praise: [
    "냠냠! 최고예요! 🍎",
    "역시 갓생러! 맛있다~",
    "할 일 완료! 배가 든든해요 😋",
    "오늘도 해냈군요! 대단해요!",
    "이 맛에 키워지는 거죠! 🍰",
    "XP 쑥쑥! 기분 최고예요!",
    "당신은 프로 완료러예요 ✨",
  ],
  // 완료 해제 (XP 회수)
  uncheck: [
    "어라...? 밥을 다시 뺏어 가는 거예요? 😢",
    "방금 먹은 거 도로 내놨어요... XP -20",
    "완료가 아니었군요... 다시 힘내요!",
  ],
  // 미완료 할 일 삭제(포기) 잔소리
  giveUp: [
    "할 일을 버리고 도망가시는 건가요...?",
    "배고파요... 할 일 좀 해 주세요!",
    "포기는 배추 셀 때나 하는 거예요! 🥬",
    "저 방금 충격받아서 깃털 빠졌어요...",
    "그 할 일... 제 저녁밥이었는데요?",
    "도망쳐도 할 일은 내일 또 와요...",
    "흑흑, XP가 줄었어요. 제 키도 줄었어요.",
  ],
  // 완료된 할 일 정리(삭제)
  cleanDone: [
    "완료한 일 정리 완료! 깔끔해요 ✨",
    "다 먹은 접시 치웠어요 🍽️",
  ],
  // 새 할 일 추가
  add: [
    "오! 새 밥... 아니 할 일이다! 👀",
    "기대돼요! 완료하면 밥 주세요!",
    "할 일 접수 완료! 응원할게요 📣",
    "좋아요, 같이 해 봐요!",
  ],
  // 할 일 수정
  edit: [
    "할 일 내용을 바꿨어요! ✏️",
    "수정 완료! 더 맛있어 보여요.",
  ],
  // 빈 칸으로 추가하려 할 때
  emptyInput: [
    "앗, 할 일을 먼저 적어 주세요!",
    "빈 접시는 못 먹어요... 🍽️",
  ],
  // 미완료 5개 이상 (다크서클 상태)
  tired: [
    "할 일이 너무 많아요... 다크서클 생겼어요 🐼",
    "꼬르륵... 배고파서 눈이 감겨요...",
    "하나만... 하나만 완료해 주세요...",
    "미완료 할 일이 산더미예요... 💦",
  ],
  // 다크서클 상태에서 벗어났을 때
  recovered: [
    "휴~ 이제 좀 살 것 같아요! 😌",
    "다크서클이 사라졌어요! 고마워요!",
  ],
  // 할 일 넘기기 (1~2번째)
  carry: [
    "내일의 나에게 맡길게요… 🫠",
    "알겠어요, 다음에 꼭 해요! (XP -5)",
    "미루는 것도 계획이죠… 아마도요?",
  ],
  // 같은 할 일을 여러 번 넘길 때 잔소리 ({n}은 넘긴 횟수로 바뀌어요)
  carryNag: [
    "이거 벌써 {n}번째 미루는 거예요… 🥲",
    "{n}번째 이사 중인 할 일… 짐 싸기도 지쳤대요!",
    "할 일이 '또 나야?' 하고 쳐다봐요. ({n}번째)",
    "{n}번이나 미뤘으면 오늘은 해치울 때예요! 💪",
  ],
  // 마감 전에 완료 (보너스)
  bonus: [
    "마감 전에 끝냈어요! 보너스 +5 🎁",
    "약속을 지키는 갓생러! 보너스 간식까지 냠냠 🍬",
  ],
  // 마감일이 하는 날보다 앞일 때
  dueInvalid: "마감일은 하는 날과 같거나 그 뒤로 정해 주세요 📅",
  // 가만히 있을 때 혼잣말
  idle: [
    "◀ ▶ 버튼으로 다른 날짜의 할 일도 볼 수 있어요!",
    "오늘 할 일은 뭐예요?",
    "할 일을 완료하면 밥을 먹을 수 있어요!",
    "심심해요~ 할 일 하나 해치울까요?",
    "저 언제 진화해요? 두근두근",
    "B 버튼을 누르면 제 상태를 알려 드려요!",
  ],
  // 5단계 전설 상태 혼잣말
  idleLegend: [
    "갓생이란 바로 이런 것이죠 👑",
    "전설은 쉬지 않아요. 다음 할 일은요?",
    "당신 덕분에 전설이 됐어요 ✨",
  ],
  // 쓰다듬기 (A 버튼)
  pet: [
    "헤헤, 간지러워요 💕",
    "쓰다듬어 주셔서 기분 좋아요!",
    "더 쓰다듬어 주세요~",
  ],
  // 진화 축하 대사 (도착한 단계 번호 순서: 2~5단계)
  evolve: {
    2: "알을 깨고 나왔어요! 반가워요, 주인님! 🐣",
    3: "청소년이 됐어요! 이제 혼자서도 밥 먹을 수 있어요 😎",
    4: "어른이 됐어요! 책임감 있는 다마고치랍니다 💼",
    5: "전설의 갓생 다마고치 등극!! 당신 덕분이에요 👑✨",
  },
  devolve: "으앗... 퇴화했어요 😭 다시 키워 주세요!",
  reset: "모든 게 처음으로... 다시 알이 됐어요 🥚",
  saveError: "앗, 저장에 실패했어요 😢 잠시 후 다시 해 주세요.",
  // 앱을 열었을 때 인사 (단계 번호 1~5)
  greet: {
    1: "톡톡... 알 속에서 기다리는 중이에요 🥚 할 일을 완료해 주세요!",
    2: "안녕하세요! 오늘도 맛있는 할 일 주세요 🐣",
    3: "왔어요? 오늘 할 일 같이 해치워요!",
    4: "좋은 하루예요. 오늘 계획은 무엇인가요?",
    5: "전설의 귀환! 오늘도 갓생 가 볼까요? 👑",
  },
};

/* =========================================================
   3. 저장소 계층 (Storage Layer)
   ---------------------------------------------------------
   앱의 나머지 코드는 데이터를 직접 저장하지 않고
   항상 store.메서드() 를 통해서만 저장/불러오기를 해요.
   저장소는 두 가지예요.
     - FirebaseStore: 아이디로 로그인했을 때 (Firestore 클라우드에 저장)
     - LocalStore   : '로그인 없이 체험하기'일 때 (이 브라우저에만 저장)
   둘 다 메서드 이름이 같아서, 로그인 방식에 따라 store 변수만 바꿔 끼우면 돼요.

   ▶ 데이터 구조 (두 저장소 모두 같은 모양)
     users/{uid}                      ← 프로필 문서 (다마고치 상태)
       { xp, stage, createdAt, updatedAt }
     users/{uid}/todos/{todoId}       ← 할 일 문서들
       { id, text, done, createdAt, updatedAt, completedAt }

   ▶ 모든 메서드는 async(비동기)예요.
     localStorage는 바로 끝나지만, Firebase는 인터넷을 거쳐 시간이 걸려요.
     둘 다 async로 맞춰 두었기 때문에 호출하는 코드는 어느 저장소든 똑같아요.
   ========================================================= */

// ▼ 체험 모드용 저장소 (localStorage)
const LocalStore = {
  // 사용자마다 다른 칸(key)에 저장해요. 예: "tamado:local-user"
  _key(uid) {
    return `tamado:${uid}`;
  },

  // localStorage에서 사용자 데이터 전체를 읽어요.
  _read(uid) {
    try {
      const raw = localStorage.getItem(this._key(uid));
      // 저장된 게 없으면 빈 구조를 돌려줘요. todos는 { 아이디: 할일 } 형태 (Firestore 컬렉션과 비슷)
      return raw ? JSON.parse(raw) : { profile: null, todos: {} };
    } catch (error) {
      // 시크릿 모드 등으로 localStorage를 못 쓰면 빈 데이터로 시작해요.
      console.warn("저장된 데이터를 읽지 못했어요:", error);
      return { profile: null, todos: {} };
    }
  },

  // 사용자 데이터 전체를 localStorage에 써요.
  _write(uid, data) {
    localStorage.setItem(this._key(uid), JSON.stringify(data));
  },

  // 프로필(다마고치 상태) 불러오기. 없으면 null
  async loadProfile(uid) {
    return this._read(uid).profile;
  },

  // 프로필 저장 (Firestore의 setDoc(..., { merge: true })와 같은 역할)
  async saveProfile(uid, profile) {
    const data = this._read(uid);
    data.profile = { ...data.profile, ...profile };
    this._write(uid, data);
  },

  // 할 일 목록 불러오기 (최신순 정렬)
  async loadTodos(uid) {
    const todos = Object.values(this._read(uid).todos || {});
    return todos.sort((a, b) => b.createdAt - a.createdAt);
  },

  // 할 일 하나 추가
  async addTodo(uid, todo) {
    const data = this._read(uid);
    data.todos[todo.id] = { ...todo };
    this._write(uid, data);
  },

  // 할 일 하나의 일부 내용만 수정 (patch = 바뀐 부분만 담은 객체)
  async updateTodo(uid, id, patch) {
    const data = this._read(uid);
    if (!data.todos[id]) return;
    data.todos[id] = { ...data.todos[id], ...patch };
    this._write(uid, data);
  },

  // 할 일 하나 삭제
  async deleteTodo(uid, id) {
    const data = this._read(uid);
    delete data.todos[id];
    this._write(uid, data);
  },

  // 사용자 데이터 전체 삭제 (시연용 초기화)
  async resetAll(uid) {
    localStorage.removeItem(this._key(uid));
  },
};

/*
  ▼ Firebase 저장소 (Firestore)
  LocalStore와 메서드 이름·사용법이 똑같아요.
  그래서 나머지 코드는 지금 어느 저장소를 쓰는지 몰라도 그대로 동작해요.

  [Firestore 보안 규칙] 콘솔 → Firestore Database → 규칙 탭의 기존 내용을 지우고 붙여넣은 뒤 '게시'
  ※ 아래 설명 4줄은 복사하지 마세요! rules_version = '2'; 부터 맨 마지막 } 까지만 복사해요.
  - 다마고치 데이터(users)는 본인만 읽고 쓸 수 있어요.
  - 아이디 계정 중에서도 '가입 명단(accounts)'에 등록된 경우에만 데이터를 쓸 수 있어요.
  - 가입 카운터(meta/signup)는 '+1씩, 최대 20, 명단 등록과 동시에'일 때만 바뀌어요.
    → 화면 코드를 고쳐서 우회해도 서버(Firestore)가 21번째 등록을 거부해요.

    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        function signedIn() { return request.auth != null; }
        function isIdUser() { return request.auth.token.firebase.sign_in_provider == 'password'; }
        function signupPath() { return /databases/$(database)/documents/meta/signup; }
        function accountPath(uid) { return /databases/$(database)/documents/accounts/$(uid); }

        // 다마고치 데이터: 본인만, 그리고 가입 명단에 등록된 아이디 계정만
        match /users/{uid}/{document=**} {
          allow read, write: if signedIn() && isIdUser() && request.auth.uid == uid
            && exists(accountPath(uid));
        }

        // 가입 카운터: 남은 자리 표시를 위해 누구나 읽기 가능
        match /meta/signup {
          allow read: if true;
          allow create: if signedIn() && isIdUser()
            && request.resource.data.keys().hasOnly(['count'])
            && request.resource.data.count == 1
            && !exists(accountPath(request.auth.uid))
            && existsAfter(accountPath(request.auth.uid));
          allow update: if signedIn() && isIdUser()
            && request.resource.data.keys().hasOnly(['count'])
            && request.resource.data.count == resource.data.count + 1
            && request.resource.data.count <= 20
            && !exists(accountPath(request.auth.uid))
            && existsAfter(accountPath(request.auth.uid));
        }

        // 아이디 계정 가입 명단: 카운터가 함께 +1 될 때만 등록 가능, 수정·삭제 불가
        match /accounts/{uid} {
          allow read: if signedIn() && request.auth.uid == uid;
          allow create: if signedIn() && isIdUser() && request.auth.uid == uid
            && request.resource.data.keys().hasOnly(['username', 'createdAt'])
            && ((exists(signupPath())
                  && getAfter(signupPath()).data.count == get(signupPath()).data.count + 1)
                || (!exists(signupPath()) && getAfter(signupPath()).data.count == 1));
        }
      }
    }
*/
const FirebaseStore = {
  // users/{uid} 문서 = 다마고치 프로필
  async loadProfile(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  },

  // merge: true → 문서 전체를 덮어쓰지 않고 보낸 필드만 바꿔요.
  async saveProfile(uid, profile) {
    await setDoc(doc(db, "users", uid), profile, { merge: true });
  },

  // users/{uid}/todos 컬렉션 = 할 일 목록 (최신순 정렬)
  async loadTodos(uid) {
    const snap = await getDocs(collection(db, "users", uid, "todos"));
    return snap.docs.map((d) => d.data()).sort((a, b) => b.createdAt - a.createdAt);
  },

  // 할 일 id를 문서 id로 그대로 써서 LocalStore와 구조를 맞춰요.
  async addTodo(uid, todo) {
    await setDoc(doc(db, "users", uid, "todos", todo.id), todo);
  },

  async updateTodo(uid, id, patch) {
    await updateDoc(doc(db, "users", uid, "todos", id), patch);
  },

  async deleteTodo(uid, id) {
    await deleteDoc(doc(db, "users", uid, "todos", id));
  },

  // 시연용 초기화: 할 일 문서를 모두 지우고 프로필도 지워요. (batch = 한 번에 묶어서 처리)
  async resetAll(uid) {
    const snap = await getDocs(collection(db, "users", uid, "todos"));
    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "users", uid));
    await batch.commit();
  },
};

// ★ 지금 사용 중인 저장소
//   아이디 로그인 → FirebaseStore,  '로그인 없이 체험하기' → LocalStore 가 들어가요.
let store = FirebaseStore;

/* =========================================================
   4. 로그인 계층 (Auth Layer)
   ---------------------------------------------------------
   - 아이디 로그인: 아이디 + 비밀번호로 계정을 만들어요. (최대 20개)
     → Firebase에 저장되니까 어느 기기에서 로그인해도 이어서 키울 수 있어요.
   - 로그인 없이 체험: 이 브라우저(localStorage)에만 저장 → 인터넷이 불안한 발표장에서 유용해요.
   실제 로그인 화면 처리는 14번(앱 시작)에 있어요.
   ========================================================= */

// 체험 모드 사용자 정보
const GUEST_USER = { uid: "local-user", displayName: "체험 모드", isGuest: true };

// 아이디 계정 설정
const MAX_ACCOUNTS = 20;               // 아이디 계정은 최대 20개까지 (보안 규칙의 20과 같게!)
const ID_PATTERN = /^[a-z0-9_]{4,12}$/; // 아이디 규칙: 영문 소문자, 숫자, _ 로 4~12자
const MIN_PASSWORD_LENGTH = 6;          // Firebase 비밀번호 최소 길이

/*
  Firebase의 비밀번호 로그인은 '이메일' 형식만 받아요.
  그래서 아이디를 "아이디@프로젝트주소" 모양의 가짜 이메일로 바꿔서 써요.
  이 주소로 메일이 가는 일은 없고, 사용자는 아이디만 알면 돼요.
*/
const ID_EMAIL_DOMAIN = "hw-todo-7efc9.firebaseapp.com";

function idToEmail(id) {
  return `${id}@${ID_EMAIL_DOMAIN}`;
}

function emailToId(email) {
  return String(email || "").split("@")[0];
}

// 이 Firebase 사용자가 아이디(이메일/비밀번호) 계정인가?
function isIdAccount(firebaseUser) {
  return firebaseUser.providerData.some((p) => p.providerId === "password");
}

// Firebase 사용자 정보를 앱에서 쓰는 모양으로 바꿔요.
function toAppUser(firebaseUser) {
  const isIdUser = (firebaseUser.email || "").endsWith(`@${ID_EMAIL_DOMAIN}`);
  return {
    uid: firebaseUser.uid,
    displayName: isIdUser
      ? emailToId(firebaseUser.email) // 아이디 계정은 가짜 이메일 대신 아이디만 보여 줘요
      : firebaseUser.displayName || firebaseUser.email || "이름 없음",
    isGuest: false,
  };
}

// 코드(code)가 붙은 오류 만들기 (Firebase 오류와 같은 방식으로 처리하려고)
function appError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Firestore가 너무 오래 대답하지 않으면 기다리지 않고 오류로 처리해요.
// (데이터베이스를 아직 안 만들었거나 인터넷이 끊기면 응답 없이 계속 기다리는 경우가 있어요)
const FIRESTORE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms = FIRESTORE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(appError("app/timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 가입 카운터 문서 위치: meta/signup  { count: 지금까지 가입한 아이디 계정 수 }
const signupCounterRef = () => doc(db, "meta", "signup");

// 지금까지 만들어진 아이디 계정 수
async function getSignupCount() {
  const snap = await withTimeout(getDoc(signupCounterRef()));
  return snap.exists() ? snap.data().count || 0 : 0;
}

// 가입 명단에 자리 잡기: 명단 등록 + 카운터 +1 을 '한 번에(batch)' 기록해요.
// 20개가 다 찼으면 보안 규칙이 거부해서 permission-denied 오류가 나요.
async function claimAccountSlot(uid, id) {
  const batch = writeBatch(db);
  batch.set(doc(db, "accounts", uid), { username: id, createdAt: Date.now() });
  batch.set(signupCounterRef(), { count: increment(1) }, { merge: true });
  await withTimeout(batch.commit());
}

// 가입 절차 중인지 표시 (가입 도중에 onAuthStateChanged가 먼저 게임을 시작하지 않게)
let signingUp = false;

// [계정 만들기] 아이디 + 비밀번호로 새 계정 만들기
async function signUpWithId(id, password) {
  // 1) 남은 자리를 먼저 확인해요. 꽉 찼으면 계정 자체를 만들지 않아요.
  if ((await getSignupCount()) >= MAX_ACCOUNTS) throw appError("app/full");

  signingUp = true;
  try {
    // 2) Firebase 로그인 계정 만들기
    const credential = await createUserWithEmailAndPassword(auth, idToEmail(id), password);

    // 3) 가입 명단에 자리 잡기. 실패하면(동시에 가입해서 꽉 찬 경우 등) 방금 만든 계정을 지워요.
    try {
      await claimAccountSlot(credential.user.uid, id);
    } catch (error) {
      await deleteUser(credential.user).catch(() => {});
      throw error.code === "permission-denied" ? appError("app/full") : error;
    }
    return credential.user;
  } finally {
    signingUp = false;
  }
}

// 아이디 계정이 가입 명단에 있는지 확인해요.
// (가입 중 인터넷이 끊겨 명단 등록을 못 했던 계정이면 자리가 남았을 때 다시 등록해요)
async function ensureAccountSlot(firebaseUser) {
  const snap = await withTimeout(getDoc(doc(db, "accounts", firebaseUser.uid)));
  if (snap.exists()) return true;
  try {
    await claimAccountSlot(firebaseUser.uid, emailToId(firebaseUser.email));
    return true;
  } catch (error) {
    if (error.code === "permission-denied") return false; // 자리가 없어요
    throw error;
  }
}

// 로그인 실패 이유를 쉬운 한국어로 바꿔요.
function getLoginErrorMessage(error) {
  switch (error && error.code) {
    case "auth/operation-not-allowed":
      return "Firebase 콘솔 → Authentication → 로그인 방법에서 '이메일/비밀번호'를 사용 설정해 주세요.";
    case "auth/configuration-not-found":
      // Authentication 메뉴에서 '시작하기'를 아직 누르지 않았을 때 나오는 오류
      return "Firebase 콘솔 → Authentication에서 '시작하기'를 누르고 로그인 방법에서 '이메일/비밀번호'를 사용 설정해 주세요.";
    // ----- 아이디 로그인 / 계정 만들기 -----
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "아이디 또는 비밀번호가 맞지 않아요.";
    case "auth/email-already-in-use":
      return "이미 사용 중인 아이디예요. 다른 아이디를 써 주세요.";
    case "auth/weak-password":
      return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`;
    case "auth/too-many-requests":
      return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
    case "app/full":
      return `아쉽지만 계정 정원(${MAX_ACCOUNTS}개)이 모두 찼어요 😢 '로그인 없이 체험하기'를 이용해 주세요.`;
    case "app/timeout":
    case "unavailable":
      return "Firestore가 응답하지 않아요. 콘솔에서 Firestore 데이터베이스를 만들었는지, 인터넷이 연결됐는지 확인해 주세요.";
    case "permission-denied":
      return "Firestore 보안 규칙에 막혔어요. app.js 안내대로 규칙을 게시했는지 확인해 주세요.";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인해 주세요. '로그인 없이 체험하기'로도 시작할 수 있어요.";
    default:
      return `로그인에 실패했어요. (${(error && (error.code || error.message)) || "알 수 없는 오류"})`;
  }
}

/* =========================================================
   5. 앱 상태 (state)
   ---------------------------------------------------------
   화면에 보이는 모든 정보는 여기 있는 값으로 결정돼요.
   ========================================================= */
const state = {
  uid: null,        // 현재 사용자 아이디 (로그인 전에는 null)
  user: null,       // 현재 사용자 정보 { uid, displayName, isGuest }
  profile: null,    // { xp, stage, createdAt, updatedAt, lastCheckInDate }
  todos: [],        // 할 일 배열 (모든 날짜)
  selectedDate: "", // 지금 화면에 보고 있는 날짜 "YYYY-MM-DD"
  lastSeenDay: "",  // 마지막으로 확인한 '오늘' 날짜 (자정이 지났는지 알아내는 데 사용)
  filter: "all",    // 현재 필터: all | active | done
  tempMood: null,   // 잠깐 동안만 보여 줄 표정 (happy, eating, shocked)
  soundOn: true,    // 효과음 켜짐 여부
  // 화면에 보여 줄 XP를 잠시 고정하는 값 (카운트다운 중에는 진화를 미리 보여 주지 않으려고)
  // null이면 실제 XP를 그대로 보여 줘요.
  viewHoldXp: null,
};

// 화면에 표시할 XP: 카운트다운 중이면 고정된 값, 아니면 실제 값
function getViewXp() {
  return state.viewHoldXp ?? state.profile.xp;
}

// 처음 시작할 때의 프로필 모양
function createDefaultProfile() {
  const now = Date.now();
  return { xp: 0, stage: 1, createdAt: now, updatedAt: now };
}

/* =========================================================
   6. 화면 요소(DOM) 찾기
   ---------------------------------------------------------
   자주 쓰는 요소를 미리 찾아서 els 객체에 담아 둬요.
   ========================================================= */
const $ = (id) => document.getElementById(id);

const els = {
  device: document.querySelector(".device"),
  screen: $("screen"),
  levelText: $("levelText"),
  stageName: $("stageName"),
  hungerText: $("hungerText"),
  xpBar: $("xpBar"),
  xpFill: $("xpFill"),
  xpText: $("xpText"),
  bubble: $("bubble"),
  bubbleText: $("bubbleText"),
  pet: $("pet"),
  pixelGrid: $("pixelGrid"),
  effectLayer: $("effectLayer"),
  btnPet: $("btnPet"),
  btnTalk: $("btnTalk"),
  btnSound: $("btnSound"),
  soundState: $("soundState"),
  todoForm: $("todoForm"),
  todoInput: $("todoInput"),
  dueInput: $("dueInput"),
  // 날짜 이동
  prevDayBtn: $("prevDayBtn"),
  nextDayBtn: $("nextDayBtn"),
  todayBtn: $("todayBtn"),
  dateLabel: $("dateLabel"),
  dateRelative: $("dateRelative"),
  // 접속 시 '지난 일 가져오기' 창
  checkinModal: $("checkinModal"),
  checkinDesc: $("checkinDesc"),
  checkinList: $("checkinList"),
  checkinBringBtn: $("checkinBringBtn"),
  checkinSkipBtn: $("checkinSkipBtn"),
  filterButtons: document.querySelectorAll(".filter"),
  countAll: $("countAll"),
  countActive: $("countActive"),
  countDone: $("countDone"),
  todoList: $("todoList"),
  emptyMessage: $("emptyMessage"),
  userInfo: $("userInfo"),
  resetBtn: $("resetBtn"),
  confettiLayer: $("confettiLayer"),
  // 로그인 화면 & 로그아웃
  idForm: $("idForm"),
  idTabs: document.querySelectorAll(".id-tab"),
  idInput: $("idInput"),
  pwInput: $("pwInput"),
  pwConfirmInput: $("pwConfirmInput"),
  slotInfo: $("slotInfo"),
  idSubmitBtn: $("idSubmitBtn"),
  loginGate: $("loginGate"),
  guestBtn: $("guestBtn"),
  loginMessage: $("loginMessage"),
  logoutBtn: $("logoutBtn"),
  // 미니 다마고치
  miniPet: $("miniPet"),
  miniPetBody: $("miniPetBody"),
  miniGrid: $("miniGrid"),
  miniBubble: $("miniBubble"),
  miniCountdown: $("miniCountdown"),
  miniXpFill: $("miniXpFill"),
  miniEffects: $("miniEffects"),
};

/* =========================================================
   작은 도우미 함수들
   ========================================================= */

// 배열에서 아무거나 하나 고르기
function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 겹치지 않는 아이디 만들기 (Firestore 문서 id로도 그대로 쓸 수 있어요)
function createId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// XP로 현재 단계 번호(0~4) 구하기: 기준 XP를 넘은 마지막 단계
function getStageIndex(xp) {
  let index = 0;
  STAGES.forEach((stage, i) => {
    if (xp >= stage.minXp) index = i;
  });
  return index;
}

/*
  ▼ 날짜 도우미 함수
  - 날짜는 "2026-11-13" 같은 글자(문자열)로 저장해요.
    글자로 저장하면 시간대 걱정이 없고, 크기 비교("2026-11-12" < "2026-11-13")도 바로 돼요.
  - 모든 날짜는 사용자 기기의 시간(한국이면 한국 시간) 기준이에요.
*/

// Date 객체 → "YYYY-MM-DD"
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "YYYY-MM-DD" → Date 객체 (그날 0시)
function fromDateStr(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// 오늘 날짜 "YYYY-MM-DD"
function todayStr() {
  return toDateStr(new Date());
}

// 날짜에 n일 더하기 (빼려면 음수)
function addDays(str, n) {
  const date = fromDateStr(str);
  date.setDate(date.getDate() + n);
  return toDateStr(date);
}

// 두 날짜 사이의 일수 (to - from). 예: daysBetween("2026-11-13", "2026-11-15") = 2
function daysBetween(from, to) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// "2026-11-15" → "11/15"
function formatShort(str) {
  const [, m, d] = str.split("-").map(Number);
  return `${m}/${d}`;
}

// "2026-11-13" → "11월 13일 (금)"
function formatLong(str) {
  const date = fromDateStr(str);
  const week = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${week})`;
}

// 마감일이 지났는가? (완료하지 않았고, 마감일이 오늘보다 앞)
function isOverdue(todo, today = todayStr()) {
  return !todo.done && !!todo.dueDate && todo.dueDate < today;
}

// 다마고치 배고픔 개수 = 오늘 못 한 일 + 마감 지난 일 (중복 없이)
function getPendingCount() {
  const today = todayStr();
  return state.todos.filter((todo) => !todo.done && (todo.date === today || isOverdue(todo, today))).length;
}

// 다크서클 상태인가?
function isTired() {
  return getPendingCount() >= TIRED_THRESHOLD;
}

// 저장을 뒤에서 처리하고, 실패하면 말풍선으로 알려 줘요.
function persist(...promises) {
  Promise.all(promises).catch((error) => {
    console.error("저장 실패:", error);
    speak(MESSAGES.saveError);
  });
}

// 요소에 애니메이션 클래스를 붙였다가, 끝나면 자동으로 떼요. (같은 애니메이션을 연달아 재생 가능)
function playAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // 브라우저가 클래스 제거를 인식하게 하는 요령 (리플로우)
  element.classList.add(className);
  element.addEventListener(
    "animationend",
    () => element.classList.remove(className),
    { once: true }
  );
}

/* =========================================================
   7. 픽셀 캐릭터 그리기
   ========================================================= */

// 16×16 = 256개의 픽셀 칸을 담아 둘 배열 (큰 캐릭터용, 미니 캐릭터용)
const pixelCells = [];
const miniCells = [];

// 픽셀 칸 256개를 만들어 container에 붙이고, cells 배열에 담아요.
function buildGrid(container, cells) {
  const fragment = document.createDocumentFragment(); // 한꺼번에 붙이면 더 빨라요
  for (let i = 0; i < 16 * 16; i++) {
    const cell = document.createElement("span"); // 버튼 안에는 span을 써야 올바른 HTML이에요
    cell.className = "px";
    cells.push(cell);
    fragment.appendChild(cell);
  }
  container.appendChild(fragment);
}

// 처음 한 번만 큰 캐릭터와 미니 캐릭터의 픽셀 칸을 만들어요.
function buildPixelGrid() {
  buildGrid(els.pixelGrid, pixelCells);
  buildGrid(els.miniGrid, miniCells);
}

// 단계 그림 + 표정 그림을 합쳐서 픽셀 칸에 색을 칠해요.
function drawSprite(stage, mood) {
  // 1) 몸 그림을 2차원 배열로 복사 (원본을 망가뜨리지 않게)
  const grid = stage.sprite.map((row) => row.split(""));

  // 2) 얼굴 그림을 face 위치에 덮어쓰기 ('.'은 건너뛰어서 몸이 보이게)
  const face = FACES[mood] || FACES.normal;
  face.forEach((row, y) => {
    row.split("").forEach((char, x) => {
      if (char !== ".") grid[stage.face.y + y][stage.face.x + x] = char;
    });
  });

  // 3) 글자를 색으로 바꿔서 칸마다 칠하기 (큰 캐릭터와 미니 캐릭터에 똑같이)
  const palette = { ...COMMON_PALETTE, ...stage.palette };
  grid.flat().forEach((char, i) => {
    const color = char === "." ? "transparent" : palette[char];
    [pixelCells[i], miniCells[i]].forEach((cell) => {
      cell.style.backgroundColor = color;
      cell.classList.toggle("is-sparkle", char === "s");
    });
  });
}

// 지금 보여 줄 표정 결정: 잠깐 표정 > 다크서클 > 보통
function getCurrentMood() {
  if (state.tempMood) return state.tempMood;
  return isTired() ? "tired" : "normal";
}

// 단계나 표정이 바뀌었을 때만 다시 칠해요. (불필요한 작업 줄이기)
let lastPetKey = "";

function renderPet() {
  const stageIndex = getStageIndex(getViewXp());
  const mood = getCurrentMood();
  const key = `${stageIndex}-${mood}`;

  if (key !== lastPetKey) {
    drawSprite(STAGES[stageIndex], mood);
    lastPetKey = key;
  }

  // CSS에서 5단계 금빛 효과에 사용
  els.pet.dataset.stage = String(stageIndex + 1);
  els.miniPetBody.dataset.stage = String(stageIndex + 1);
  els.screen.classList.toggle("is-tired", isTired());
  els.miniPet.classList.toggle("is-tired", isTired());
}

// 큰 캐릭터와 미니 캐릭터에 같은 반응 애니메이션을 재생해요.
function animatePet(className) {
  playAnimation(els.pet, className);
  playAnimation(els.miniPetBody, className);
}

// 잠깐 동안 특정 표정을 보여 주고, 시간이 지나면 원래 표정으로 돌아가요.
let moodTimer = null;

function setTempMood(mood, duration = 1600) {
  state.tempMood = mood;
  renderPet();
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => {
    state.tempMood = null;
    renderPet();
  }, duration);
}

/* =========================================================
   8. 다마고치 반응 (말풍선, 애니메이션, 폭죽)
   ========================================================= */

// 마지막으로 말한 시각 (혼잣말 타이밍 계산용)
let lastSpeakAt = 0;

// 미니 말풍선을 숨길 타이머
let miniBubbleTimer = null;

// 말풍선에 대사 띄우기 (큰 말풍선 + 미니 말풍선 둘 다)
function speak(text) {
  els.bubbleText.textContent = text;
  playAnimation(els.bubble, "is-pop");
  lastSpeakAt = Date.now();

  // 미니 말풍선은 4초 동안만 보여 줘요.
  els.miniBubble.textContent = text;
  els.miniPet.classList.add("is-talking");
  clearTimeout(miniBubbleTimer);
  miniBubbleTimer = setTimeout(() => els.miniPet.classList.remove("is-talking"), 4000);
}

// 효과 레이어에 잠깐 나타났다 사라지는 요소 추가 (layer를 안 주면 큰 화면에 표시)
function spawnEffect(className, text, layer = els.effectLayer) {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  layer.appendChild(el);
  // 애니메이션이 끝나면 스스로 지워져요. (혹시 몰라 3초 뒤에도 한 번 더 정리)
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 3000);
}

// XP 변화 글자 띄우기: +20 XP / -10 XP
function showXpChange(delta) {
  const sign = delta > 0 ? "+" : "";
  const className = `float-text${delta < 0 ? " is-minus" : ""}`;
  spawnEffect(className, `${sign}${delta} XP`);
  // 미니 다마고치가 떠 있으면 거기에도 표시
  if (!deviceVisible) spawnEffect(className, `${sign}${delta}`, els.miniEffects);
}

// 밥 먹기 연출: 음식이 날아와서 → 냠냠 → 기뻐하기
// count: 음식 개수 (카운트다운으로 모아 먹을 때는 여러 개가 연달아 날아와요. 최대 5개)
// 반환값: 연출이 끝나는 데 걸리는 시간(ms) → 진화 연출을 그 뒤에 이어 붙일 때 사용
function feedPet(count = 1) {
  const foods = Math.min(Math.max(count, 1), 5);
  const gap = 250; // 음식끼리 간격
  for (let i = 0; i < foods; i++) {
    setTimeout(() => spawnEffect("food", pickRandom(FOODS)), i * gap);
  }
  const extra = (foods - 1) * gap; // 음식이 많을수록 냠냠을 늦게 시작
  setTimeout(() => {
    setTempMood("eating", 1000);
    animatePet("is-eating");
  }, 650 + extra);
  setTimeout(() => {
    setTempMood("happy", 1400);
    animatePet("is-happy");
  }, 1650 + extra);
  return 1700 + extra;
}

// 충격 연출: 덜덜 떨기 + 느낌표
function shockPet() {
  setTempMood("shocked", 1800);
  animatePet("is-shocked");
  spawnEffect("shock-mark", "!");
}

// 화면 전체에 색종이 폭죽 뿌리기
function launchConfetti(count = 90) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    // 조각마다 위치, 크기, 속도, 회전을 랜덤으로 정해 CSS 변수로 넘겨요.
    piece.style.setProperty("--x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 200}px`);
    piece.style.setProperty("--rot", `${Math.random() * 900 - 450}deg`);
    piece.style.setProperty("--dur", `${2.2 + Math.random() * 1.6}s`);
    piece.style.setProperty("--delay", `${Math.random() * 0.5}s`);
    piece.style.setProperty("--w", `${6 + Math.random() * 6}px`);
    piece.style.setProperty("--h", `${8 + Math.random() * 8}px`);
    piece.style.setProperty("--color", pickRandom(CONFETTI_COLORS));
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
    fragment.appendChild(piece);
  }
  els.confettiLayer.appendChild(fragment);
  // 안전장치: 5초 뒤 남은 조각 정리
  setTimeout(() => (els.confettiLayer.innerHTML = ""), 5000);
}

// 진화 연출: 화면 번쩍 + 회전 + 배너 + 폭죽 + 축하 대사
function celebrateEvolution(newStageIndex) {
  const stage = STAGES[newStageIndex];
  playAnimation(els.screen, "is-flash");
  animatePet("is-evolving");
  spawnEffect("evolve-banner", `EVOLUTION! Lv.${stage.level}`);
  launchConfetti();
  playSound("evolve");
  speak(MESSAGES.evolve[stage.level]);
}

// 혼잣말: 한동안 아무 말이 없으면 상태에 맞는 대사를 해요.
function idleTalk() {
  if (!state.uid) return; // 로그인 전에는 조용히
  if (document.hidden) return; // 다른 탭을 보고 있으면 쉬어요
  if (Date.now() - lastSpeakAt < 15000) return;

  if (isTired()) {
    speak(pickRandom(MESSAGES.tired));
  } else if (getStageIndex(state.profile.xp) === STAGES.length - 1) {
    speak(pickRandom(MESSAGES.idleLegend));
  } else {
    speak(pickRandom(MESSAGES.idle));
  }
}

// B 버튼: 현재 상태 알려 주기
function talkStatus() {
  const xp = state.profile.xp;
  const index = getStageIndex(xp);
  const next = STAGES[index + 1];
  const pending = getPendingCount();

  if (isTired()) {
    speak(`미완료 할 일이 ${pending}개예요... 배고파요 😵`);
  } else if (next) {
    // 다음 단계까지 남은 XP와 완료해야 할 개수 계산
    const needXp = next.minXp - xp;
    const needTodos = Math.ceil(needXp / XP_RULES.COMPLETE);
    speak(`'${next.name}'까지 ${needXp} XP! 할 일 ${needTodos}개만 더 완료해 주세요!`);
  } else {
    speak(`저는 이미 전설이에요 👑 총 ${xp} XP를 모았어요!`);
  }
  playSound("click");
}

// A 버튼 또는 캐릭터 클릭: 쓰다듬기
function petPet() {
  setTempMood("happy", 1200);
  animatePet("is-petted");
  spawnEffect("float-text is-emoji", "💕");
  speak(isTired() ? pickRandom(MESSAGES.tired) : pickRandom(MESSAGES.pet));
  playSound("click");
}

/* =========================================================
   9. 8비트 효과음 (Web Audio API)
   ---------------------------------------------------------
   소리 파일 없이 브라우저가 직접 '삐빅' 소리를 만들어요.
   ========================================================= */
let audioCtx = null;

// 효과음 종류별 음 높이(Hz)와 파형
const SOUNDS = {
  click: { notes: [880], type: "square", length: 0.05 },
  tick: { notes: [1200], type: "square", length: 0.03 }, // 카운트다운 째깍
  add: { notes: [660, 880], type: "square", length: 0.06 },
  eat: { notes: [523, 659, 784, 1047], type: "square", length: 0.07 },
  down: { notes: [440, 330], type: "triangle", length: 0.1 },
  shock: { notes: [330, 220, 165], type: "sawtooth", length: 0.09 },
  evolve: { notes: [523, 659, 784, 1047, 784, 1047, 1319], type: "square", length: 0.1 },
  devolve: { notes: [392, 330, 262, 196], type: "triangle", length: 0.12 },
};

function playSound(name) {
  if (!state.soundOn) return;
  const sound = SOUNDS[name];
  if (!sound) return;

  try {
    // 브라우저 정책상 사용자가 클릭한 뒤에야 소리를 낼 수 있어서, 처음 필요할 때 만들어요.
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();

    const start = audioCtx.currentTime;
    sound.notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator(); // 소리 발생기
      const gain = audioCtx.createGain();      // 볼륨 조절기
      const t = start + i * sound.length;

      osc.type = sound.type;
      osc.frequency.setValueAtTime(freq, t);
      // 작게 시작 → 짧게 울리고 → 부드럽게 꺼지기 (딱딱 끊기는 잡음 방지)
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + sound.length);

      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + sound.length + 0.02);
    });
  } catch (error) {
    console.warn("효과음을 재생하지 못했어요:", error);
  }
}

// 효과음 켜기/끄기 설정은 이 브라우저에만 저장해요. (DB에 넣을 필요 없는 개인 설정)
const SOUND_PREF_KEY = "tamado:sound";

function loadSoundPref() {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

function toggleSound() {
  state.soundOn = !state.soundOn;
  try {
    localStorage.setItem(SOUND_PREF_KEY, state.soundOn ? "on" : "off");
  } catch {
    /* 저장 못 해도 지금 화면에서는 동작해요 */
  }
  renderSoundState();
  playSound("click");
  speak(state.soundOn ? "소리를 켰어요 🔊" : "쉿, 조용히 할게요 🔇");
}

function renderSoundState() {
  els.soundState.textContent = state.soundOn ? "켜짐" : "꺼짐";
  els.btnSound.classList.toggle("is-off", !state.soundOn);
}

/* =========================================================
   10. XP와 진화 처리
   ========================================================= */

// XP를 더하거나 빼고, 이전/이후 단계를 알려 줘요. (XP는 0 밑으로 내려가지 않아요)
function applyXp(delta) {
  const oldStage = getStageIndex(state.profile.xp);
  state.profile.xp = Math.max(0, state.profile.xp + delta);
  const newStage = getStageIndex(state.profile.xp);

  state.profile.stage = newStage + 1; // 저장용 단계 번호 (1~5)
  state.profile.updatedAt = Date.now();

  showXpChange(delta);
  return { oldStage, newStage };
}

// 단계가 바뀌었으면 진화/퇴화 연출을 해요.
function handleStageChange(oldStage, newStage, delay = 0) {
  if (newStage > oldStage) {
    setTimeout(() => celebrateEvolution(newStage), delay);
  } else if (newStage < oldStage) {
    setTimeout(() => {
      speak(MESSAGES.devolve);
      playSound("devolve");
    }, delay);
  }
}

/* =========================================================
   10-1. 미니 다마고치 & 완료 카운트다운
   ---------------------------------------------------------
   목록을 보느라 게임기가 화면 밖에 있을 때의 흐름
   1) 완료 체크 → 미니 다마고치에 3초 카운트다운 시작
   2) 카운트다운 중에 또 완료 → 다시 3초부터 (모아 둔 개수 +1)
   3) 0이 되면 → 게임기 화면으로 스크롤 → 모아 둔 반응(밥, XP, 진화)을 한 번에 연출
   ※ XP는 체크하는 순간 바로 저장해요. 미뤄지는 건 '보여 주는 연출'뿐이라
     카운트다운 중에 창을 닫아도 XP는 사라지지 않아요.
   ========================================================= */

// 게임기 LCD 화면이 지금 충분히 보이는가? (IntersectionObserver가 계속 갱신해 줘요)
let deviceVisible = true;

// 카운트다운으로 모으는 중인 완료 묶음. 없으면 null
// { count: 모은 완료 개수, oldStage: 모으기 전 단계, startXp: 모으기 전 XP,
//   remaining: 남은 초, timer: 1초 타이머, revealing: 게임기로 올라가는 중인지 }
let batch = null;

// 게임기 화면이 보이는지 감시해서 미니 다마고치를 보여 주거나 숨겨요.
function watchDevice() {
  if (!("IntersectionObserver" in window)) return; // 아주 오래된 브라우저면 항상 '보임'으로 처리

  const observer = new IntersectionObserver(
    ([entry]) => {
      // LCD 화면이 60% 이상 보이면 '보임'
      deviceVisible = entry.intersectionRatio >= 0.6;
      els.miniPet.classList.toggle("is-shown", !deviceVisible);
      els.miniPet.setAttribute("aria-hidden", String(deviceVisible));
      els.miniPet.tabIndex = deviceVisible ? -1 : 0;

      // 카운트다운 중에 사용자가 직접 위로 올라왔다면 기다리지 않고 바로 보여 줘요.
      if (deviceVisible && batch) revealBatch();
    },
    { threshold: [0, 0.6, 1] }
  );
  observer.observe(els.screen);
}

// 게임기 화면으로 부드럽게 스크롤
function scrollToDevice() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  els.device.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

// 완료 묶음 시작: 지금 화면에 보이는 XP를 고정해서 진화를 미리 들키지 않게 해요.
function startBatch() {
  batch = {
    count: 0,
    oldStage: getStageIndex(state.profile.xp),
    startXp: state.profile.xp,
    remaining: COUNTDOWN_SECONDS,
    timer: null,
    revealing: false,
  };
  state.viewHoldXp = state.profile.xp;
}

// 카운트다운을 처음부터(3초) 다시 시작
function restartCountdown() {
  batch.remaining = COUNTDOWN_SECONDS;
  renderCountdown();
  clearInterval(batch.timer);
  batch.timer = setInterval(tickCountdown, 1000);
}

// 1초마다 실행: 숫자를 하나씩 줄이고 0이 되면 게임기로 이동
function tickCountdown() {
  if (!batch) return;
  // 할 일을 수정하는 중이면 끝날 때까지 기다려요. (글 쓰다가 화면이 올라가면 불편하니까)
  if (document.querySelector(".todo-item.is-editing")) return;

  batch.remaining -= 1;
  if (batch.remaining <= 0) {
    revealBatch();
  } else {
    renderCountdown();
    playSound("tick");
  }
}

// 미니 다마고치의 숫자 배지 갱신
function renderCountdown() {
  els.miniCountdown.hidden = !batch;
  if (batch) {
    els.miniCountdown.textContent = String(batch.remaining);
    playAnimation(els.miniCountdown, "is-pop");
  }
}

// 묶음 정리: 타이머를 멈추고 화면 XP 고정을 풀어요.
function clearBatch() {
  if (!batch) return;
  clearInterval(batch.timer);
  batch = null;
  state.viewHoldXp = null;
  renderCountdown();
}

// 완료를 모두 해제해서 모은 게 0개가 되면: 화면 이동 없이 취소
function cancelBatch() {
  const oldStage = batch.oldStage;
  clearBatch();
  render();
  handleStageChange(oldStage, getStageIndex(state.profile.xp));
}

// 카운트다운 끝! 게임기 화면으로 올라가서 모아 둔 반응을 한 번에 보여 줘요.
function revealBatch() {
  // 이미 보여 주러 가는 중이면 무시 (스크롤 중에 화면 감시가 한 번 더 부르는 것 방지)
  if (!batch || batch.revealing) return;
  batch.revealing = true;
  clearInterval(batch.timer);
  batch.timer = null;
  els.miniCountdown.hidden = true;

  const show = () => {
    if (!batch) return; // 그 사이 초기화됐다면 아무것도 안 해요
    // 스크롤하는 동안 더 체크했을 수도 있으니, 보여 주는 순간의 값을 읽어요.
    const { count, oldStage, startXp } = batch;
    clearBatch();
    render(); // 고정을 풀었으니 XP 게이지가 이제 차올라요

    const netXp = state.profile.xp - startXp; // 모으는 동안 바뀐 XP 합계
    const duration = feedPet(count);
    playSound("eat");
    if (netXp !== 0) showXpChange(netXp);

    if (count >= 2) {
      speak(`${count}개 한꺼번에 냠냠! 배 터지겠어요 😋 (${netXp >= 0 ? "+" : ""}${netXp} XP)`);
    } else {
      speak(pickRandom(MESSAGES.praise));
    }
    // 밥을 다 먹은 뒤 진화(또는 퇴화) 연출
    handleStageChange(oldStage, getStageIndex(state.profile.xp), duration);
  };

  if (deviceVisible) {
    show();
  } else {
    scrollToDevice();
    setTimeout(show, 700); // 스크롤이 끝날 즈음 연출 시작
  }
}

// 미니 다마고치를 눌렀을 때: 카운트다운 중이면 바로 보여 주고, 아니면 게임기로 이동
function onMiniPetClick() {
  if (batch) revealBatch();
  else scrollToDevice();
}

/* =========================================================
   11. 할 일 기능
   ========================================================= */

// 다크서클 상태로 들어가거나 벗어났는지 확인하고 한마디 해요.
function checkTiredChange(wasTired) {
  const nowTired = isTired();
  if (!wasTired && nowTired) {
    speak(pickRandom(MESSAGES.tired));
    return true;
  }
  if (wasTired && !nowTired) {
    speak(pickRandom(MESSAGES.recovered));
    return true;
  }
  return false;
}

// [추가] 새 할 일 만들기
function addTodo(text) {
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);

  // 빈 칸이면 입력창을 흔들고 안내해요.
  if (!trimmed) {
    playAnimation(els.todoInput, "is-error");
    speak(pickRandom(MESSAGES.emptyInput));
    return;
  }

  // 마감일(선택)은 하는 날과 같거나 그 뒤여야 해요.
  const date = state.selectedDate; // 지금 보고 있는 날짜에 추가
  const dueDate = els.dueInput.value || null;
  if (dueDate && dueDate < date) {
    playAnimation(els.dueInput, "is-error");
    speak(MESSAGES.dueInvalid);
    return;
  }

  const wasTired = isTired();
  const now = Date.now();
  const todo = {
    id: createId(),
    text: trimmed,
    done: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    date,               // 하는 날 "YYYY-MM-DD"
    dueDate,            // 마감일 "YYYY-MM-DD" 또는 null
    originDate: date,   // 처음 계획한 날 (넘겨도 바뀌지 않아요)
    carryCount: 0,      // 넘긴 횟수
    bonusXp: 0,         // 완료할 때 받은 마감 보너스 (해제하면 회수하려고 기억해 둬요)
  };

  state.todos.unshift(todo); // 맨 위에 추가
  els.todoInput.value = "";
  els.dueInput.value = "";
  render();

  // 다크서클로 바뀌었으면 그 대사를, 아니면 추가 대사를 해요.
  if (!checkTiredChange(wasTired)) speak(pickRandom(MESSAGES.add));
  playSound("add");

  persist(store.addTodo(state.uid, todo));
}

// [완료/해제] 체크박스 토글
function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;

  const wasTired = isTired();
  const now = Date.now();
  todo.done = !todo.done;
  todo.completedAt = todo.done ? now : null;
  todo.updatedAt = now;

  // 게임기가 안 보이는데 완료했다면 → 카운트다운 묶음 시작 (XP를 바꾸기 전에 화면 XP 고정)
  if (todo.done && !deviceVisible && !batch) startBatch();

  // XP 계산: 완료 +20 (+ 마감일 당일까지면 보너스 +5) / 해제하면 받은 만큼 모두 회수
  let delta;
  let gotBonus = false;
  if (todo.done) {
    gotBonus = !!todo.dueDate && todayStr() <= todo.dueDate;
    todo.bonusXp = gotBonus ? XP_RULES.DUE_BONUS : 0;
    delta = XP_RULES.COMPLETE + todo.bonusXp;
  } else {
    delta = XP_RULES.UNCHECK - (todo.bonusXp || 0);
    todo.bonusXp = 0;
  }
  const { oldStage, newStage } = applyXp(delta);

  if (batch) {
    // ----- 카운트다운으로 모으는 중 -----
    batch.count += todo.done ? 1 : -1;

    if (todo.done) {
      // 미니 다마고치가 살짝 기뻐하고, 3초부터 다시 세요.
      render();
      setTempMood("happy", 900);
      playAnimation(els.miniPetBody, "is-happy");
      playSound("eat");
      // 이미 게임기로 올라가는 중이면 카운트다운은 다시 시작하지 않아요. (도착하면 함께 보여 줌)
      if (!batch.revealing) {
        restartCountdown();
        const bonusText = gotBonus ? " 마감 보너스 +5 🎁" : "";
        speak(`냠! ${batch.count}개째 완료!${bonusText} ${COUNTDOWN_SECONDS}초 뒤에 보러 가요 👀`);
      }
    } else if (batch.count <= 0 && !batch.revealing) {
      // 모은 걸 다 해제했으면 카운트다운 취소
      cancelBatch();
      setTempMood("shocked", 1200);
      playSound("down");
      speak(pickRandom(MESSAGES.uncheck));
    } else {
      // 아직 남은 게 있으면 카운트다운은 그대로 계속
      render();
      setTempMood("shocked", 1200);
      playSound("down");
      speak(pickRandom(MESSAGES.uncheck));
    }
  } else if (todo.done) {
    render();
    // 완료: 밥 먹기 + 칭찬
    feedPet();
    playSound("eat");
    if (!checkTiredChange(wasTired)) {
      speak(pickRandom(gotBonus ? MESSAGES.bonus : MESSAGES.praise));
    }
    // 밥을 다 먹은 뒤에 진화하도록 조금 늦게 연출
    handleStageChange(oldStage, newStage, 1700);
  } else {
    // 해제: XP 회수 + 시무룩
    render();
    setTempMood("shocked", 1200);
    playSound("down");
    if (!checkTiredChange(wasTired)) speak(pickRandom(MESSAGES.uncheck));
    handleStageChange(oldStage, newStage, 900);
  }

  persist(
    store.updateTodo(state.uid, id, {
      done: todo.done,
      completedAt: todo.completedAt,
      updatedAt: todo.updatedAt,
      bonusXp: todo.bonusXp,
    }),
    store.saveProfile(state.uid, state.profile)
  );
}

// [삭제] 완료된 할 일은 그냥 정리, 미완료 할 일은 '포기'로 XP -10
function deleteTodo(id, listItem) {
  const todo = state.todos.find((t) => t.id === id);
  // 이미 지우는 중이면 무시 (빠르게 두 번 눌러 XP가 두 번 깎이는 것 방지)
  if (!todo || listItem.classList.contains("is-removing")) return;

  // 사라지는 애니메이션을 보여 준 다음 실제로 지워요.
  listItem.classList.add("is-removing");
  setTimeout(() => {
    const wasTired = isTired();
    state.todos = state.todos.filter((t) => t.id !== id);

    if (todo.done) {
      // 완료된 일 정리: XP 변화 없음
      render();
      if (!checkTiredChange(wasTired)) speak(pickRandom(MESSAGES.cleanDone));
      playSound("click");
      persist(store.deleteTodo(state.uid, id));
      return;
    }

    // 미완료 할 일 포기: 충격 + 잔소리 + XP -10
    const { oldStage, newStage } = applyXp(XP_RULES.GIVE_UP);
    render();
    shockPet();
    playSound("shock");
    // 포기했을 때는 다크서클이 풀려도 잔소리가 우선이에요.
    speak(pickRandom(MESSAGES.giveUp));
    // 카운트다운 중이면 단계 변화는 나중에 한꺼번에 보여 줘요.
    if (!batch) handleStageChange(oldStage, newStage, 1500);

    persist(
      store.deleteTodo(state.uid, id),
      store.saveProfile(state.uid, state.profile)
    );
  }, 280);
}

// [수정] 글자와 마감일을 고칠 수 있게 입력칸으로 바꿔요.
function startEdit(listItem, id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo || listItem.classList.contains("is-editing")) return;

  listItem.classList.add("is-editing");

  // 1) 글자 → 글자 입력칸
  const textEl = listItem.querySelector(".todo-text");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "todo-edit";
  input.value = todo.text;
  input.maxLength = MAX_TEXT_LENGTH;
  input.setAttribute("aria-label", "할 일 수정");
  textEl.replaceWith(input);

  // 2) 마감일 입력칸 (비우면 마감일 없음)
  const dueRow = document.createElement("label");
  dueRow.className = "todo-edit-due";
  dueRow.innerHTML = `<span>📅 마감일</span>`;
  const dueEdit = document.createElement("input");
  dueEdit.type = "date";
  dueEdit.className = "due-input";
  dueEdit.value = todo.dueDate || "";
  dueEdit.min = todo.date;
  dueEdit.setAttribute("aria-label", "마감일 수정 (비우면 없음)");
  dueRow.appendChild(dueEdit);
  listItem.querySelector(".todo-main").appendChild(dueRow);

  input.focus();
  input.select();

  let finished = false; // Enter와 포커스 이동이 동시에 일어나도 한 번만 처리하려는 표시

  const finish = (save) => {
    if (finished) return;
    finished = true;

    const newText = input.value.trim().slice(0, MAX_TEXT_LENGTH);
    let newDue = dueEdit.value || null;
    if (newDue && newDue < todo.date) {
      speak(MESSAGES.dueInvalid);
      newDue = todo.dueDate; // 잘못된 마감일은 무시하고 원래대로
    }

    const textChanged = !!newText && newText !== todo.text;
    const dueChanged = newDue !== (todo.dueDate || null);
    if (save && (textChanged || dueChanged)) {
      if (textChanged) todo.text = newText;
      todo.dueDate = newDue;
      todo.updatedAt = Date.now();
      speak(pickRandom(MESSAGES.edit));
      playSound("click");
      persist(
        store.updateTodo(state.uid, id, {
          text: todo.text,
          dueDate: todo.dueDate,
          updatedAt: todo.updatedAt,
        })
      );
    }
    render(); // 입력칸을 다시 글자로 되돌려요 (마감일이 바뀌면 배고픔 수도 바뀔 수 있어서 전체 다시 그리기)
  };

  bindEnterKey(input, () => finish(true));
  listItem.addEventListener("keydown", (e) => {
    if (e.key === "Escape") finish(false); // Esc: 취소
  });
  // 글자칸 ↔ 마감일칸 사이 이동은 괜찮고, 이 할 일 밖으로 포커스가 나가면 저장해요.
  // (날짜 선택 달력이 열릴 때 잠깐 포커스가 흔들리는 경우가 있어서 0.15초 뒤에 다시 확인해요)
  listItem.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!listItem.contains(document.activeElement)) finish(true);
    }, 150);
  });
}

// [초기화] 시연용: 모든 데이터를 지우고 알부터 다시 시작
async function resetAll() {
  const ok = confirm("정말 처음부터 다시 키울까요?\n모든 할 일과 XP가 사라져요.");
  if (!ok) return;

  try {
    await store.resetAll(state.uid);
  } catch (error) {
    console.error("초기화 실패:", error);
    speak(MESSAGES.saveError);
    return;
  }

  clearBatch(); // 카운트다운 중이었다면 취소
  state.profile = createDefaultProfile();
  state.profile.lastCheckInDate = todayStr(); // 초기화 직후에 '지난 일 가져오기'를 묻지 않도록
  state.todos = [];
  state.filter = "all";
  state.selectedDate = todayStr();
  state.tempMood = null;
  render();
  animatePet("is-evolving");
  speak(MESSAGES.reset);
  playSound("devolve");
  persist(store.saveProfile(state.uid, state.profile));
}

/* =========================================================
   11-1. 날짜 기능 (날짜 이동 / 넘기기 / 접속 시 지난 일 가져오기)
   ========================================================= */

// 예전 버전에서 만든 할 일에 날짜 정보가 없으면 채워 줘요.
// (만든 날짜를 '하는 날'로 정해요) → 바뀐 게 있으면 true
function normalizeTodo(todo) {
  let changed = false;
  if (!todo.date) {
    todo.date = toDateStr(new Date(todo.createdAt || Date.now()));
    changed = true;
  }
  if (!todo.originDate) {
    todo.originDate = todo.date;
    changed = true;
  }
  if (todo.dueDate === undefined) {
    todo.dueDate = null;
    changed = true;
  }
  if (typeof todo.carryCount !== "number") {
    todo.carryCount = 0;
    changed = true;
  }
  if (typeof todo.bonusXp !== "number") {
    todo.bonusXp = 0;
    changed = true;
  }
  return changed;
}

// 날짜 이동 (◀ -1, ▶ +1)
function moveDate(days) {
  state.selectedDate = addDays(state.selectedDate, days);
  renderFilters();
  renderList();
  renderDateNav();
  playSound("click");
}

function goToday() {
  state.selectedDate = todayStr();
  renderFilters();
  renderList();
  renderDateNav();
  playSound("click");
}

// 넘길 목적지: 지난 날 할 일 → 오늘, 오늘·미래 할 일 → 그다음 날
function getCarryTarget(todo, today = todayStr()) {
  return todo.date < today ? today : addDays(todo.date, 1);
}

// 넘기기 대사 (여러 번 넘기면 잔소리)
function getCarryMessage(maxCount) {
  if (maxCount >= CARRY_NAG_COUNT) {
    return pickRandom(MESSAGES.carryNag).replace("{n}", String(maxCount));
  }
  return pickRandom(MESSAGES.carry);
}

// 할 일 하나를 날짜 이동 + 넘긴 횟수 +1 (XP는 부른 쪽에서 처리)
function moveTodoTo(todo, target) {
  todo.date = target;
  todo.carryCount = (todo.carryCount || 0) + 1;
  todo.updatedAt = Date.now();
  return store.updateTodo(state.uid, todo.id, {
    date: todo.date,
    carryCount: todo.carryCount,
    updatedAt: todo.updatedAt,
  });
}

// [내일로 / 오늘로] 버튼
function carryTodo(id, listItem) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo || todo.done || listItem.classList.contains("is-removing")) return;

  const target = getCarryTarget(todo);
  const leavesView = target !== state.selectedDate; // 지금 보는 날짜에서 사라지는지

  const doCarry = () => {
    const wasTired = isTired();
    const saving = moveTodoTo(todo, target);
    const { oldStage, newStage } = applyXp(XP_RULES.CARRY);
    render();

    // 다마고치 반응: 3번째부터는 충격 + 잔소리
    if (todo.carryCount >= CARRY_NAG_COUNT) {
      shockPet();
      playSound("shock");
    } else {
      setTempMood("shocked", 900);
      playSound("down");
    }
    const message = getCarryMessage(todo.carryCount);
    if (!checkTiredChange(wasTired) || todo.carryCount >= CARRY_NAG_COUNT) speak(message);
    if (!batch) handleStageChange(oldStage, newStage, 1200);

    persist(saving, store.saveProfile(state.uid, state.profile));
  };

  if (leavesView) {
    listItem.classList.add("is-removing"); // 옆으로 휙 사라진 뒤 이동
    setTimeout(doCarry, 280);
  } else {
    doCarry();
  }
}

// 접속 시 물어볼 '지난 날 못 한 일' 고르기
// - 마지막으로 물어본 날(lastCheckInDate)부터 어제까지의 못 한 일만 골라요.
//   그 전에 '그냥 두기'한 일은 다시 묻지 않아요.
function getCheckInCandidates(today = todayStr()) {
  const since = state.profile.lastCheckInDate || "0000-00-00";
  return state.todos
    .filter((t) => !t.done && t.date < today && t.date >= since)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.createdAt - a.createdAt));
}

// 하루에 한 번: 지난 날 못 한 일이 있으면 가져올지 물어봐요. 없으면 인사만 해요.
function maybeCheckIn() {
  const today = todayStr();
  if (!state.uid || state.profile.lastCheckInDate === today) return false;

  const candidates = getCheckInCandidates(today);
  if (candidates.length === 0) {
    state.profile.lastCheckInDate = today;
    persist(store.saveProfile(state.uid, state.profile));
    return false;
  }
  openCheckIn(candidates);
  return true;
}

// '지난 일 가져오기' 창 열기
function openCheckIn(candidates) {
  els.checkinDesc.textContent = `지난 날 못 한 일이 ${candidates.length}개 있어요. 오늘로 가져올까요?`;
  els.checkinList.innerHTML = "";

  candidates.forEach((todo) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <label class="checkin__item">
        <input type="checkbox" checked />
        <span class="checkin__text"></span>
        <span class="checkin__date"></span>
      </label>`;
    li.querySelector("input").value = todo.id;
    li.querySelector(".checkin__text").textContent = todo.text; // 사용자 글자는 textContent로
    const carried = todo.carryCount ? ` · ↪${todo.carryCount}` : "";
    li.querySelector(".checkin__date").textContent = formatShort(todo.date) + carried;
    els.checkinList.appendChild(li);
  });

  updateCheckInButton();
  els.checkinModal.hidden = false;
  els.checkinBringBtn.focus();
}

// 체크한 개수에 맞춰 '가져오기' 버튼 글자 바꾸기
function updateCheckInButton() {
  const count = els.checkinList.querySelectorAll("input:checked").length;
  els.checkinBringBtn.disabled = count === 0;
  els.checkinBringBtn.textContent =
    count === 0 ? "가져올 할 일을 골라 주세요" : `${count}개 가져오기 (XP ${XP_RULES.CARRY * count})`;
}

// 창 닫기 + 결정 반영 (selectedIds: 가져올 할 일 id 목록, 빈 배열이면 '그냥 두기')
function resolveCheckIn(selectedIds) {
  els.checkinModal.hidden = true;
  const today = todayStr();
  const moved = state.todos.filter((t) => selectedIds.includes(t.id) && !t.done);

  const savings = moved.map((todo) => moveTodoTo(todo, today));
  state.profile.lastCheckInDate = today; // 오늘은 다시 묻지 않아요 (다른 기기에서도)
  state.selectedDate = today;

  if (moved.length === 0) {
    render();
    persist(store.saveProfile(state.uid, state.profile));
    speak("알겠어요! 지난 일은 그 날짜에 그대로 둘게요. 오늘도 힘내요 💪");
    return;
  }

  const { oldStage, newStage } = applyXp(XP_RULES.CARRY * moved.length);
  render();
  persist(...savings, store.saveProfile(state.uid, state.profile));

  const maxCount = Math.max(...moved.map((t) => t.carryCount));
  if (maxCount >= CARRY_NAG_COUNT) {
    shockPet();
    speak(getCarryMessage(maxCount));
  } else {
    setTempMood("shocked", 900);
    speak(`지난 일 ${moved.length}개를 오늘로 가져왔어요! 오늘은 꼭 해치워요 🔥`);
  }
  playSound("down");
  handleStageChange(oldStage, newStage, 1200);
}

// 화면을 켜 둔 채 자정이 지났다면: '오늘'을 새 날짜로 바꾸고 지난 일을 물어봐요.
function checkDayChange() {
  if (!state.uid || document.hidden) return;
  const today = todayStr();
  if (state.lastSeenDay === today) return;
  if (state.selectedDate === state.lastSeenDay) state.selectedDate = today; // '오늘'을 보던 중이면 새 오늘로
  state.lastSeenDay = today;
  render();
  maybeCheckIn();
}

/* =========================================================
   12. 화면 다시 그리기 (render)
   ========================================================= */

// 전체 다시 그리기
function render() {
  renderStatus();
  renderPet();
  renderDateNav();
  renderFilters();
  renderList();
}

// 날짜 이동 영역: "11월 13일 (금)" + 오늘/어제/내일 + [오늘로] 버튼
function renderDateNav() {
  const today = todayStr();
  const diff = daysBetween(today, state.selectedDate);
  const relative = { 0: "오늘", "-1": "어제", 1: "내일" }[diff];

  els.dateLabel.textContent = formatLong(state.selectedDate);
  els.dateRelative.textContent = relative || (diff < 0 ? `${-diff}일 전` : `${diff}일 뒤`);
  els.dateRelative.classList.toggle("is-today", diff === 0);
  els.todayBtn.hidden = diff === 0;

  // 마감일 입력칸은 '하는 날'보다 앞 날짜를 고를 수 없게
  els.dueInput.min = state.selectedDate;
}

// 지금 보고 있는 날짜의 할 일
// - 오늘 화면에는 '다른 날짜에 있지만 마감이 지난 할 일'도 함께 보여 줘요. (배고픔 개수와 맞추려고)
function getDayTodos() {
  const today = todayStr();
  const date = state.selectedDate;
  return state.todos.filter(
    (t) => t.date === date || (date === today && t.date < today && isOverdue(t, today))
  );
}

// 레벨, 단계 이름, XP 게이지, 배고픔 표시
function renderStatus() {
  const xp = getViewXp(); // 카운트다운 중이면 고정된 XP를 보여 줘요
  const index = getStageIndex(xp);
  const stage = STAGES[index];
  const next = STAGES[index + 1];

  els.levelText.textContent = `Lv.${stage.level}`;
  els.stageName.textContent = stage.name;

  // 게이지: 현재 단계 시작점 ~ 다음 단계 시작점 사이에서 얼마나 왔는지 (%)
  let percent = 100;
  if (next) {
    percent = ((xp - stage.minXp) / (next.minXp - stage.minXp)) * 100;
    els.xpText.textContent = `${xp} / ${next.minXp} XP`;
  } else {
    els.xpText.textContent = `${xp} XP MAX`;
  }
  const width = `${Math.min(100, Math.max(0, percent))}%`;
  els.xpFill.style.width = width;
  els.miniXpFill.style.width = width; // 미니 게이지도 같이
  els.xpBar.setAttribute("aria-valuenow", String(Math.round(percent)));

  const pending = getPendingCount();
  els.hungerText.textContent = `🍽️ ${pending}`;
  els.hungerText.classList.toggle("is-warning", pending >= TIRED_THRESHOLD);
}

// 필터 버튼의 선택 상태와 개수
function renderFilters() {
  const dayTodos = getDayTodos();
  const total = dayTodos.length;
  const done = dayTodos.filter((t) => t.done).length;

  els.countAll.textContent = total;
  els.countActive.textContent = total - done;
  els.countDone.textContent = done;

  els.filterButtons.forEach((btn) => {
    const active = btn.dataset.filter === state.filter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

// 현재 필터에 맞는 할 일만 골라요.
function getFilteredTodos() {
  const dayTodos = getDayTodos();
  if (state.filter === "active") return dayTodos.filter((t) => !t.done);
  if (state.filter === "done") return dayTodos.filter((t) => t.done);
  return dayTodos;
}

// 할 일 목록 그리기
function renderList() {
  const todos = getFilteredTodos();
  const fragment = document.createDocumentFragment();
  todos.forEach((todo) => fragment.appendChild(createTodoElement(todo)));

  els.todoList.innerHTML = "";
  els.todoList.appendChild(fragment);

  // 비어 있을 때 필터에 맞는 안내 문구
  const isPast = state.selectedDate < todayStr();
  const emptyTexts = {
    all: isPast ? "이 날은 할 일이 없었어요." : "아직 할 일이 없어요. 첫 번째 밥(할 일)을 주세요! 🍙",
    active: "남은 할 일이 없어요! 배불러요 😋",
    done: "아직 완료한 일이 없어요. 하나 해치워 볼까요?",
  };
  els.emptyMessage.hidden = todos.length > 0;
  els.emptyMessage.textContent = emptyTexts[state.filter];
}

// 마감일 표시 정보: { text, cls } 또는 null
function getDueInfo(todo, today = todayStr()) {
  if (!todo.dueDate) return null;
  const short = formatShort(todo.dueDate);
  if (todo.done) return { text: `📅 마감 ${short}`, cls: "" };

  const left = daysBetween(today, todo.dueDate); // 마감까지 남은 일수
  if (left < 0) return { text: `📅 마감 지남 (${short})`, cls: "is-over" };
  if (left === 0) return { text: `📅 오늘 마감 (D-day)`, cls: "is-soon" };
  if (left === 1) return { text: `📅 마감 ${short} (D-1)`, cls: "is-soon" };
  return { text: `📅 마감 ${short} (D-${left})`, cls: "" };
}

// 할 일 한 줄(<li>) 만들기
function createTodoElement(todo) {
  const today = todayStr();
  const li = document.createElement("li");
  li.className = `todo-item${todo.done ? " is-done" : ""}`;
  li.dataset.id = todo.id;

  // 틀은 innerHTML로 만들되, 사용자가 쓴 글자는 아래에서 textContent로 넣어요.
  // (사용자 글자를 innerHTML에 넣으면 <script> 같은 코드가 실행될 위험이 있어요)
  li.innerHTML = `
    <label class="todo-check">
      <input type="checkbox" class="todo-check__input" ${todo.done ? "checked" : ""} />
      <span class="todo-check__box" aria-hidden="true"></span>
    </label>
    <div class="todo-main">
      <span class="todo-text" title="더블클릭해서 수정"></span>
      <div class="todo-meta"></div>
    </div>
    <div class="todo-actions">
      <button type="button" class="icon-btn" data-action="edit" aria-label="수정">✏️</button>
      <button type="button" class="icon-btn icon-btn--danger" data-action="delete" aria-label="삭제">🗑️</button>
    </div>
  `;
  li.querySelector(".todo-text").textContent = todo.text;
  li.querySelector(".todo-check__input").setAttribute(
    "aria-label",
    `${todo.text} ${todo.done ? "완료 해제" : "완료"}`
  );

  // --- 아래쪽 작은 표식들 (글자는 모두 앱이 만든 것이라 안전해요) ---
  const meta = li.querySelector(".todo-meta");
  const addBadge = (text, cls, action, label) => {
    const el = document.createElement(action ? "button" : "span");
    if (action) {
      el.type = "button";
      el.dataset.action = action;
    }
    el.className = `badge ${cls}`;
    el.textContent = text;
    if (label) el.setAttribute("aria-label", label);
    meta.appendChild(el);
  };

  // ↪ 넘어온 표식 (누르면 처음 날짜를 알려 줘요)
  if (todo.carryCount > 0) {
    const text = todo.carryCount === 1 ? "↪ 넘어옴" : `↪ ${todo.carryCount}번째`;
    const nag = todo.carryCount >= CARRY_NAG_COUNT ? " is-nag" : "";
    addBadge(text, `badge--carry${nag}`, "carry-info", `${text}, 처음 날짜 보기`);
  }

  // 오늘 화면에 보이는 '다른 날의 마감 지난 일'에는 원래 날짜 표시
  if (todo.date !== state.selectedDate) {
    addBadge(`🗓️ ${formatShort(todo.date)}의 할 일`, "badge--from");
  }

  // 📅 마감일
  const due = getDueInfo(todo, today);
  if (due) addBadge(due.text, `badge--due ${due.cls}`);

  // 내일로 / 오늘로 버튼 (못 한 일에만)
  if (!todo.done) {
    const toToday = todo.date < today;
    const carry = document.createElement("button");
    carry.type = "button";
    carry.className = "carry-btn";
    carry.dataset.action = "carry";
    carry.textContent = toToday ? "오늘로 ➜" : "내일로 ➜";
    carry.title = `${toToday ? "오늘로" : "다음 날로"} 넘기기 (XP ${XP_RULES.CARRY})`;
    meta.appendChild(carry);
  }
  return li;
}

/* =========================================================
   13. 이벤트 연결
   ========================================================= */

/*
  한글 입력(IME) 중 Enter 문제 해결 도우미
  - 한글은 글자를 '조합'하는 중에 Enter를 누르면, 브라우저에 따라
    마지막 글자가 입력창에 남거나 두 번 추가되는 문제가 있어요.
  - 조합 중이면(isComposing) 조합이 끝나는 순간(compositionend)까지 기다렸다가 실행해요.
*/
function bindEnterKey(input, onEnter) {
  let waitingComposition = false;

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.isComposing) {
      waitingComposition = true; // 조합이 끝나면 실행
      return;
    }
    onEnter();
  });

  input.addEventListener("compositionend", () => {
    if (!waitingComposition) return;
    waitingComposition = false;
    setTimeout(onEnter, 0); // 조합된 글자가 입력창에 확정된 뒤 실행
  });
}

function bindEvents() {
  // 할 일 추가: Enter 키 (한글 조합 대응)
  bindEnterKey(els.todoInput, () => addTodo(els.todoInput.value));

  // 할 일 추가: '추가' 버튼 클릭
  els.todoForm.addEventListener("submit", (e) => {
    e.preventDefault(); // 페이지 새로고침 막기
    addTodo(els.todoInput.value);
  });

  // 목록 안의 클릭/변경은 목록(ul) 하나에서 모아서 처리해요. (이벤트 위임)
  // → 할 일이 새로 생겨도 이벤트를 다시 달 필요가 없어요.
  els.todoList.addEventListener("change", (e) => {
    if (!e.target.classList.contains("todo-check__input")) return;
    const li = e.target.closest(".todo-item");
    toggleTodo(li.dataset.id);
  });

  els.todoList.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    const li = button.closest(".todo-item");
    const action = button.dataset.action;
    if (action === "edit") startEdit(li, li.dataset.id);
    if (action === "delete") deleteTodo(li.dataset.id, li);
    if (action === "carry") carryTodo(li.dataset.id, li);
    if (action === "carry-info") {
      const todo = state.todos.find((t) => t.id === li.dataset.id);
      if (todo) speak(`${formatShort(todo.originDate)}에 계획했던 할 일이에요. 벌써 ${todo.carryCount}번 넘어왔어요!`);
    }
  });

  // 글자를 더블클릭해도 수정
  els.todoList.addEventListener("dblclick", (e) => {
    if (!e.target.classList.contains("todo-text")) return;
    const li = e.target.closest(".todo-item");
    startEdit(li, li.dataset.id);
  });

  // 날짜 이동
  els.prevDayBtn.addEventListener("click", () => moveDate(-1));
  els.nextDayBtn.addEventListener("click", () => moveDate(1));
  els.todayBtn.addEventListener("click", goToday);

  // 접속 시 '지난 일 가져오기' 창
  els.checkinList.addEventListener("change", updateCheckInButton);
  els.checkinBringBtn.addEventListener("click", () => {
    const ids = [...els.checkinList.querySelectorAll("input:checked")].map((input) => input.value);
    resolveCheckIn(ids);
  });
  els.checkinSkipBtn.addEventListener("click", () => resolveCheckIn([]));

  // 다른 탭에 있다가 돌아왔을 때 날짜가 바뀌었는지 확인
  document.addEventListener("visibilitychange", checkDayChange);

  // 필터 버튼
  els.filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      renderFilters();
      renderList();
      playSound("click");
    });
  });

  // 게임기 버튼과 캐릭터
  els.btnPet.addEventListener("click", petPet);
  els.pet.addEventListener("click", petPet);
  els.btnTalk.addEventListener("click", talkStatus);
  els.btnSound.addEventListener("click", toggleSound);

  // 미니 다마고치
  els.miniPet.addEventListener("click", onMiniPetClick);

  // 시연용 초기화
  els.resetBtn.addEventListener("click", resetAll);
}

/* =========================================================
   14. 앱 시작 & 로그인 화면
   ---------------------------------------------------------
   흐름
   1) 앱이 열리면 로그인 화면(게이트)이 "확인 중…"으로 떠요.
   2) Firebase가 "이미 로그인한 사람인지" 알려 줘요. (onAuthStateChanged)
      - 로그인되어 있으면 → 바로 그 사람의 다마고치를 불러와요.
      - 아니면 → 아이디 로그인 / 계정 만들기 / 체험하기를 보여 줘요.
   3) 로그아웃하면 다시 로그인 화면으로 돌아가요.
   ========================================================= */

// 로그인 화면의 버튼과 입력칸을 잠시 못 쓰게 하거나 다시 풀어요. (중복 클릭 방지)
function setLoginButtonsDisabled(disabled) {
  els.loginGate.querySelectorAll("button, input").forEach((el) => {
    el.disabled = disabled;
  });
}

// 로그인 화면 보여 주기 (message: 버튼 아래 안내 문구)
function showLoginGate(message = "") {
  els.loginGate.hidden = false;
  els.loginGate.classList.remove("is-checking");
  els.loginMessage.textContent = message;
  setLoginButtonsDisabled(false);
}

function hideLoginGate() {
  els.loginGate.hidden = true;
}

// 로그인한 사용자의 다마고치 불러와서 게임 시작
async function startSession(user, storeImpl) {
  store = storeImpl; // 로그인 방식에 맞는 저장소로 바꿔 끼우기
  state.user = user;
  state.uid = user.uid;

  els.loginGate.classList.remove("is-checking");
  els.loginMessage.textContent = "다마고치를 데려오는 중… 🥚";
  setLoginButtonsDisabled(true);

  try {
    // 프로필과 할 일을 동시에 불러오기
    const [profile, todos] = await withTimeout(
      Promise.all([store.loadProfile(state.uid), store.loadTodos(state.uid)])
    );

    // 처음 방문이면 새 프로필을 만들어 저장
    // (처음 온 사람에게는 '지난 일 가져오기'를 물을 필요가 없으니 오늘 확인한 걸로 해 둬요)
    state.profile = profile || { ...createDefaultProfile(), lastCheckInDate: todayStr() };
    state.todos = todos;
    if (!profile) persist(store.saveProfile(state.uid, state.profile));

    // 예전 버전 할 일에 날짜 정보 채우기 (바뀐 것만 저장)
    const migrated = todos.filter(normalizeTodo);
    if (migrated.length) {
      persist(
        ...migrated.map((t) =>
          store.updateTodo(state.uid, t.id, {
            date: t.date,
            originDate: t.originDate,
            dueDate: t.dueDate,
            carryCount: t.carryCount,
            bonusXp: t.bonusXp,
          })
        )
      );
    }

    // 비밀번호는 화면에 남겨 두지 않아요.
    els.pwInput.value = "";
    els.pwConfirmInput.value = "";
  } catch (error) {
    // Firestore를 아직 안 만들었거나, 보안 규칙이 막으면 여기로 와요.
    console.error("데이터를 불러오지 못했어요:", error);
    state.user = null;
    state.uid = null;
    showLoginGate(
      "데이터를 불러오지 못했어요 😢 Firestore 데이터베이스 생성과 보안 규칙을 확인해 주세요. " +
        "(급하면 '로그인 없이 체험하기'로 시작할 수 있어요)"
    );
    return;
  }

  // 화면 준비
  clearBatch();
  state.filter = "all";
  state.tempMood = null;
  state.selectedDate = todayStr();
  state.lastSeenDay = todayStr();
  els.userInfo.textContent = user.isGuest
    ? "👤 체험 모드 (이 브라우저에만 저장)"
    : `👤 ${user.displayName}`;
  els.logoutBtn.textContent = user.isGuest ? "나가기" : "로그아웃";
  render();
  hideLoginGate();

  // 인사하기 (그 전에 오늘 처음 접속이면 '지난 일 가져오기'를 먼저 물어봐요)
  const stageLevel = STAGES[getStageIndex(state.profile.xp)].level;
  speak(isTired() ? pickRandom(MESSAGES.tired) : MESSAGES.greet[stageLevel]);
  maybeCheckIn();
}

// 게임 끝내고 로그인 화면으로
function endSession(message = "") {
  clearBatch();
  els.checkinModal.hidden = true;
  state.selectedDate = todayStr();
  state.user = null;
  state.uid = null;
  state.todos = [];
  state.profile = createDefaultProfile();
  render();
  showLoginGate(message);
}

// Firebase에 로그인된 사용자를 확인하고 게임 시작
// (아이디 계정이면 가입 명단에 있는지 먼저 확인해요)
let handlingUid = null; // 같은 사용자를 두 번 처리하지 않도록 표시

async function handleFirebaseUser(firebaseUser) {
  const uid = firebaseUser.uid;
  if (state.uid === uid || handlingUid === uid) return; // 이미 시작했거나 처리 중
  handlingUid = uid;
  try {
    // 이 앱은 아이디 계정만 써요. 다른 방식(예: 예전에 쓰던 Google 로그인)이면 로그아웃시켜요.
    if (!isIdAccount(firebaseUser)) {
      await signOut(auth);
      showLoginGate("아이디로 다시 로그인해 주세요.");
      return;
    }
    const ok = await ensureAccountSlot(firebaseUser);
    if (!ok) {
      await signOut(auth);
      showLoginGate(getLoginErrorMessage(appError("app/full")));
      return;
    }
    await startSession(toAppUser(firebaseUser), FirebaseStore);
  } catch (error) {
    console.error("계정 확인 실패:", error);
    showLoginGate(getLoginErrorMessage(error));
  } finally {
    handlingUid = null;
  }
}

// 로그인 / 계정 만들기 탭 전환
function setAuthMode(mode) {
  els.idForm.dataset.mode = mode; // CSS가 이 값을 보고 '비밀번호 확인' 칸을 보이거나 숨겨요
  els.idTabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.idSubmitBtn.textContent = mode === "signup" ? "계정 만들기" : "로그인";
  els.pwInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
  els.loginMessage.textContent = "";
  if (mode === "signup") refreshSlotInfo();
}

// 계정 만들기 탭에 '남은 자리 n / 20' 표시
async function refreshSlotInfo() {
  els.slotInfo.textContent = "남은 자리 확인 중…";
  try {
    const left = Math.max(0, MAX_ACCOUNTS - (await getSignupCount()));
    els.slotInfo.textContent =
      left > 0
        ? `🎟️ 남은 자리 ${left} / ${MAX_ACCOUNTS}`
        : `😢 정원 ${MAX_ACCOUNTS}개가 모두 찼어요`;
  } catch (error) {
    console.warn("남은 자리를 확인하지 못했어요:", error);
    els.slotInfo.textContent = "";
  }
}

// [로그인] 또는 [계정 만들기] 버튼 (폼 제출)
async function onIdSubmit(event) {
  event.preventDefault(); // 페이지 새로고침 막기
  const mode = els.idForm.dataset.mode;
  const id = els.idInput.value.trim().toLowerCase();
  const password = els.pwInput.value;

  // 입력값 검사
  if (!ID_PATTERN.test(id)) {
    showLoginGate("아이디는 영문 소문자, 숫자, _ 로 4~12자여야 해요.");
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    showLoginGate(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`);
    return;
  }
  if (mode === "signup" && password !== els.pwConfirmInput.value) {
    showLoginGate("비밀번호 확인이 일치하지 않아요.");
    return;
  }

  setLoginButtonsDisabled(true);
  els.loginMessage.textContent = mode === "signup" ? "계정을 만드는 중… 🥚" : "로그인 중…";

  try {
    if (mode === "signup") {
      const user = await signUpWithId(id, password);
      await handleFirebaseUser(user); // 가입이 끝났으니 직접 게임 시작
    } else {
      await signInWithEmailAndPassword(auth, idToEmail(id), password);
      // 성공하면 onAuthStateChanged가 이어서 처리해요
    }
  } catch (error) {
    console.warn("아이디 로그인/가입 실패:", error.code || error);
    showLoginGate(getLoginErrorMessage(error));
    if (mode === "signup") refreshSlotInfo();
  }
}

// [로그인 없이 체험하기] 버튼
function onGuestLogin() {
  startSession(GUEST_USER, LocalStore);
}

// [로그아웃 / 나가기] 버튼
async function onLogout() {
  if (!state.user) return;
  if (state.user.isGuest) {
    endSession("체험 모드를 나왔어요. 체험 기록은 이 브라우저에 남아 있어요.");
    return;
  }
  try {
    await signOut(auth); // 성공하면 onAuthStateChanged(null)이 endSession을 불러요
  } catch (error) {
    console.error("로그아웃 실패:", error);
    speak("로그아웃에 실패했어요. 다시 시도해 주세요.");
  }
}

function init() {
  buildPixelGrid();
  bindEvents();
  state.soundOn = loadSoundPref();
  renderSoundState();

  // 로그인 전에도 뒤쪽 화면이 비어 보이지 않도록 기본 알을 그려 둬요.
  state.profile = createDefaultProfile();
  state.selectedDate = todayStr();
  render();
  watchDevice();

  // 로그인 화면 버튼
  els.idForm.addEventListener("submit", onIdSubmit);
  els.idTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));
  els.guestBtn.addEventListener("click", onGuestLogin);
  els.logoutBtn.addEventListener("click", onLogout);

  // Firebase가 로그인 상태를 알려 줄 때마다 실행돼요. (앱을 열 때 1번 + 로그인/로그아웃할 때마다)
  let authReady = false; // 첫 번째 알림을 받았는지
  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      // 계정 만들기 도중이면 가입 절차가 끝난 뒤 직접 처리해요.
      if (!signingUp) handleFirebaseUser(firebaseUser);
    } else if (!authReady) {
      // 앱을 처음 열었는데 로그인 안 된 상태 → 로그인 화면
      showLoginGate();
    } else if (state.user && !state.user.isGuest) {
      // 게임 중에 로그아웃함 (체험 모드로 놀고 있을 때는 건드리지 않아요)
      endSession("로그아웃했어요. 또 만나요! 👋");
    }
    authReady = true;
  });

  // 5초마다 확인해서, 오래 조용했으면 혼잣말
  setInterval(idleTalk, 5000);
  // 1분마다 자정이 지났는지 확인 (화면을 켜 둔 채 날짜가 바뀌는 경우)
  setInterval(checkDayChange, 60000);
}

init();
