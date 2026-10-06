const admin = require('firebase-admin');

function getAdminApp() {
  if (admin.apps.length) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin 환경변수가 설정되지 않았습니다.');
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey
    })
  });
}

function getDb() {
  return getAdminApp() && admin.firestore();
}

function checkPassword(req) {
  const expected = process.env.ADMIN_PASSWORD;
  const received = req.headers['x-admin-password'];
  return !!expected && !!received && received === expected;
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  try {
    // 관리자 비밀번호 확인만 하는 요청
    if (req.method === 'POST' && req.body && req.body.action === 'verify') {
      if (!checkPassword(req)) {
        return sendJson(res, 401, { ok: false, error: '비밀번호가 올바르지 않습니다.' });
      }
      return sendJson(res, 200, { ok: true });
    }

    // 조회는 누구나 가능
    if (req.method === 'GET') {
      const db = getDb();
      const snapshot = await db.collection('events').get();
      const events = [];

      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        events.push({
          id: doc.id,
          date: data.date || '',
          category: data.category || '휴일',
          content: data.content || ''
        });
      });

      events.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return String(a.id).localeCompare(String(b.id));
      });

      return sendJson(res, 200, { ok: true, events });
    }

    // 이하 쓰기 작업은 관리자 비밀번호 필요
    if (!checkPassword(req)) {
      return sendJson(res, 401, { ok: false, error: '관리자 인증이 필요합니다.' });
    }

    const db = getDb();

    if (req.method === 'POST') {
      const { date, category, content } = req.body || {};

      if (!date || !category || !content) {
        return sendJson(res, 400, { ok: false, error: '날짜, 카테고리, 내용을 모두 입력해주세요.' });
      }

      const docRef = await db.collection('events').add({
        date: String(date),
        category: String(category),
        content: String(content)
      });

      return sendJson(res, 200, { ok: true, id: docRef.id });
    }

    if (req.method === 'PATCH') {
      const { id, date, category, content } = req.body || {};

      if (!id || !date || !category || !content) {
        return sendJson(res, 400, { ok: false, error: '수정할 일정 정보가 부족합니다.' });
      }

      await db.collection('events').doc(String(id)).set({
        date: String(date),
        category: String(category),
        content: String(content)
      }, { merge: true });

      return sendJson(res, 200, { ok: true, id: String(id) });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};

      if (!id) {
        return sendJson(res, 400, { ok: false, error: '삭제할 일정 ID가 없습니다.' });
      }

      await db.collection('events').doc(String(id)).delete();
      return sendJson(res, 200, { ok: true, id: String(id) });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return sendJson(res, 405, { ok: false, error: '허용되지 않은 요청입니다.' });
  } catch (error) {
    console.error('API /api/events error:', error);
    return sendJson(res, 500, {
      ok: false,
      error: error.message || '서버 오류가 발생했습니다.'
    });
  }
};
