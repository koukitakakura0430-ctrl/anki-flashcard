/**
 * フラッシュカード PWA - Google Apps Script (GAS) API
 * 
 * Google Drive (画像保存) と Google Sheets (データベース) のミドルウェア
 */

// ===== 設定 =====
const SPREADSHEET_ID = '1ksip0-O1OONZB4p2zS5xTZzPlO7JBuEOw4pPIh5JO-4';
const DRIVE_FOLDER_ID = '1Wus5YK6UN8_FYSZxvuBSTdAdPCSFzXp6';
const SHEET_NAME = 'cards';

// ===== エントリポイント =====

function doGet(e) {
  return jsonResponse({ status: 'ok', message: 'Flashcard API is running' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    switch (action) {
      case 'uploadImage':
        return jsonResponse(uploadImage(data));
      case 'createCard':
        return jsonResponse(createCard(data));
      case 'getCards':
        return jsonResponse(getCards(data));
      case 'updateCard':
        return jsonResponse(updateCard(data));
      case 'deleteCard':
        return jsonResponse(deleteCard(data));
      case 'getFolders':
        return jsonResponse(getFolders());
      case 'syncBatch':
        return jsonResponse(syncBatch(data));
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

// ===== CORS対応レスポンス =====

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== 画像アップロード =====

function uploadImage(data) {
  const { base64, fileName, subFolder } = data;

  // Drive フォルダ取得・サブフォルダ作成
  let folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  if (subFolder) {
    const subFolders = subFolder.split('/');
    for (const sf of subFolders) {
      const existing = folder.getFoldersByName(sf);
      folder = existing.hasNext() ? existing.next() : folder.createFolder(sf);
    }
  }

  // Base64デコードして保存
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    'image/jpeg',
    fileName
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileId = file.getId();
  const url = 'https://drive.google.com/uc?id=' + fileId;

  return { success: true, url: url, fileId: fileId };
}

// ===== カード CRUD =====

function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  // シートが存在しない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'id', 'folder_path', 'front_image_url', 'back_image_url',
      'easiness_factor', 'interval', 'repetition_count',
      'next_review_date', 'created_at'
    ]);
  }

  return sheet;
}

function createCard(data) {
  const sheet = getSheet();
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  const nextReview = data.next_review_date || now;

  sheet.appendRow([
    id,
    data.folder_path || '',
    data.front_image_url || '',
    data.back_image_url || '',
    data.easiness_factor || 2.5,
    data.interval || 0,
    data.repetition_count || 0,
    nextReview,
    now
  ]);

  return {
    success: true,
    card: {
      id: id,
      folder_path: data.folder_path || '',
      front_image_url: data.front_image_url || '',
      back_image_url: data.back_image_url || '',
      easiness_factor: data.easiness_factor || 2.5,
      interval: data.interval || 0,
      repetition_count: data.repetition_count || 0,
      next_review_date: nextReview,
      created_at: now
    }
  };
}

function getCards(data) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();

  if (rows.length <= 1) {
    return { success: true, cards: [] };
  }

  const headers = rows[0];
  let cards = [];

  for (let i = 1; i < rows.length; i++) {
    const card = {};
    for (let j = 0; j < headers.length; j++) {
      card[headers[j]] = rows[i][j];
    }
    cards.push(card);
  }

  // フォルダパスでフィルタ
  if (data.folder_path) {
    cards = cards.filter(c => c.folder_path === data.folder_path || c.folder_path.startsWith(data.folder_path + '/'));
  }

  // 復習日でフィルタ（今日以前）
  if (data.due_only) {
    const today = new Date().toISOString().split('T')[0];
    cards = cards.filter(c => {
      const reviewDate = new Date(c.next_review_date).toISOString().split('T')[0];
      return reviewDate <= today;
    });
  }

  return { success: true, cards: cards };
}

function updateCard(data) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === data.id) {
      // 更新可能なフィールド
      const updatableFields = [
        'folder_path', 'front_image_url', 'back_image_url',
        'easiness_factor', 'interval', 'repetition_count', 'next_review_date'
      ];

      for (const field of updatableFields) {
        if (data[field] !== undefined) {
          const colIndex = headers.indexOf(field);
          if (colIndex !== -1) {
            sheet.getRange(i + 1, colIndex + 1).setValue(data[field]);
          }
        }
      }

      return { success: true, message: 'Card updated' };
    }
  }

  return { success: false, error: 'Card not found: ' + data.id };
}

function deleteCard(data) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === data.id) {
      // Drive 画像も削除
      const frontUrlCol = headers.indexOf('front_image_url');
      const backUrlCol = headers.indexOf('back_image_url');

      tryDeleteDriveFile(rows[i][frontUrlCol]);
      tryDeleteDriveFile(rows[i][backUrlCol]);

      sheet.deleteRow(i + 1);
      return { success: true, message: 'Card deleted' };
    }
  }

  return { success: false, error: 'Card not found: ' + data.id };
}

function tryDeleteDriveFile(url) {
  try {
    if (!url) return;
    const match = url.match(/id=([a-zA-Z0-9_-]+)/);
    if (match) {
      DriveApp.getFileById(match[1]).setTrashed(true);
    }
  } catch (e) {
    // ファイルが見つからない場合は無視
  }
}

// ===== フォルダ管理 =====

function getFolders() {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const folderCol = headers.indexOf('folder_path');

  const folderSet = new Set();
  for (let i = 1; i < rows.length; i++) {
    const path = rows[i][folderCol];
    if (path) {
      folderSet.add(path);
      // 親フォルダも追加
      const parts = path.split('/');
      for (let j = 1; j < parts.length; j++) {
        folderSet.add(parts.slice(0, j).join('/'));
      }
    }
  }

  // ツリー構造に変換
  const folders = Array.from(folderSet).sort();
  const tree = buildFolderTree(folders);

  return { success: true, folders: folders, tree: tree };
}

function buildFolderTree(paths) {
  const tree = {};
  for (const path of paths) {
    const parts = path.split('/');
    let node = tree;
    for (const part of parts) {
      if (!node[part]) node[part] = {};
      node = node[part];
    }
  }
  return tree;
}

// ===== 一括同期（オフライン復帰用） =====

function syncBatch(data) {
  const operations = data.operations || [];
  const results = [];

  for (const op of operations) {
    try {
      let result;
      switch (op.action) {
        case 'uploadImage':
          result = uploadImage(op);
          break;
        case 'createCard':
          result = createCard(op);
          break;
        case 'updateCard':
          result = updateCard(op);
          break;
        case 'deleteCard':
          result = deleteCard(op);
          break;
        default:
          result = { success: false, error: 'Unknown action: ' + op.action };
      }
      results.push({ opId: op.opId, ...result });
    } catch (e) {
      results.push({ opId: op.opId, success: false, error: e.toString() });
    }
  }

  return { success: true, results: results };
}
