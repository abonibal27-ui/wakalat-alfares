window.ABONIBAL_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCbDQd09D3qIDDdoKl-C1SdqonfPbwDHmk",
    authDomain: "abonibal-production.firebaseapp.com",
    databaseURL: "https://abonibal-production-default-rtdb.firebaseio.com",
    projectId: "abonibal-production",
    storageBucket: "abonibal-production.firebasestorage.app",
    messagingSenderId: "176125330481",
    appId: "1:176125330481:web:e5d8673b9a00d043338110",
    measurementId: "G-6MBX380NR2"
};

if (!window.firebase || !firebase.apps) {
  throw new Error('Firebase SDK is not loaded.');
}

if (!firebase.apps.length) {
  firebase.initializeApp(window.ABONIBAL_FIREBASE_CONFIG);
}

const db = firebase.database();
const storage = firebase.storage();
window.db = db;
window.storage = storage;
window.firebaseConfig = window.ABONIBAL_FIREBASE_CONFIG;
