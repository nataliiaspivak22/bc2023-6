const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000;
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static('public')); 

// З'єднання з базою даних
const db = new sqlite3.Database('inventory.db', (err) => {
  if (err) {
    console.error(err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run('CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, deviceName TEXT, description TEXT, serialNumber TEXT, manufacturer TEXT, photoPath TEXT, username TEXT, FOREIGN KEY(username) REFERENCES users(username))');
    db.run('CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT NOT NULL UNIQUE)');
  }
}); 

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/'); // Шлях для збереження файлів зображень
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + Date.now() + ext); // Генерація унікального імені файлу
  }
});

const upload = multer({ storage: storage });

// Отримання фотографії конкретного пристрою за його ID
app.get('/devices/:deviceId/photo', (req, res) => {
  const deviceId = req.params.deviceId; // Отримання параметру deviceId з URL
  
  const sql = 'SELECT photoPath FROM devices WHERE id = ?'; // Запит до бази даних для отримання photoPath за id
  const values = [deviceId];

  db.get(sql, values, (err, row) => {
      if (err) {
          res.status(500).send(err.message);
          return;
      }
      // Якщо шлях до фотографії знайдено, повертаємо фотографію клієнту
      const photoPath = row.photoPath;
      const fullPath = path.join(__dirname, 'public', photoPath); // Повний шлях до зображення
      
      res.sendFile(fullPath, (err) => {
        if (err) {
          res.status(404).send('Photo not found for the specified device ID');
        }
      });
    });
  });

  // Додавання нового пристрою
  app.post('/devices', upload.single('photo'), (req, res) => {
    const { deviceId, deviceName, description, serialNumber, manufacturer } = req.body;
    const photoPath = req.file ? '/uploads/' + req.file.filename : null; // Шлях до зображення в папці public/uploads
  
    const sql = 'INSERT INTO devices (id, deviceName, description, serialNumber, manufacturer, photoPath) VALUES (?, ?, ?, ?, ?, ?)';
    const values = [deviceId, deviceName, description, serialNumber, manufacturer, photoPath];
  
    db.run(sql, values, function (err) {
      if (err) {
        res.status(500).send(err.message);
        return;
      }
      res.send('New device added successfully');
    });
  });
  
 // Оновлення пристрою за ID
 app.put('/devices/:id', upload.single('photo'), (req, res) => {
  const deviceId = req.params.id;
  const { deviceName, description, serialNumber, manufacturer } = req.body;
  let photoPath = req.file ? '/uploads/' + req.file.filename : null;

  const sqlSelect = 'SELECT * FROM devices WHERE id = ?';
  const sqlUpdate = 'UPDATE devices SET deviceName = COALESCE(?, deviceName), description = COALESCE(?, description), serialNumber = COALESCE(?, serialNumber), manufacturer = COALESCE(?, manufacturer), photoPath = COALESCE(?, photoPath) WHERE id = ?';
  const values = [deviceName, description, serialNumber, manufacturer, photoPath, deviceId];

  db.get(sqlSelect, [deviceId], (err, row) => {
      if (err) {
          res.status(500).send(err.message);
          return;
      }

      if (!row) {
          res.status(404).send('Device not found');
          return;
      }

      db.run(sqlUpdate, values, function (err) {
          if (err) {
              res.status(500).send(err.message);
              return;
          }

          if (this.changes === 0) {
              res.status(404).send('Device not found or data unchanged');
              return;
          }

          res.status(200).send('Device updated successfully');
      });
  });
});

// Отримання списку пристроїв
app.get('/devices', (req, res) => {
    const sql = 'SELECT * FROM devices';
    db.all(sql, [], (err, rows) => {
      if (err) {
        res.status(500).send(err.message);
        return;
      }
  
      // Перевіряємо наявність файлу для кожного пристрою і оновлюємо шлях
      rows.forEach((device) => {
        if (device.photoPath) {
          const filePath = `public/${device.photoPath}`;
          if (!fs.existsSync(filePath)) {
            device.photoPath = ''; // Якщо файлу не існує, очищуємо шлях
          }
        }
      });
  
      res.json(rows);
    });
  });

// Отримання пристрою за ID
app.get('/devices/:id', (req, res) => {
    const deviceId = req.params.id;
    const sql = 'SELECT * FROM devices WHERE id = ?';
    db.get(sql, [deviceId], (err, row) => {
      if (err) {
        res.status(500).send(err.message);
        return;
      }
      if (!row) {
        res.status(404).send('Device not found');
        return;
      }
      res.json(row);
    });
  });
  
  // Видалення пристрою за ID
  app.delete('/devices/:id', (req, res) => {
    const deviceId = req.params.id;
    const sqlSelect = 'SELECT * FROM devices WHERE id = ?';
    const sqlDelete = 'DELETE FROM devices WHERE id = ?';

    db.get(sqlSelect, [deviceId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (!row) {
            res.status(404).send('Device not found');
            return;
        }

        db.run(sqlDelete, [deviceId], function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            res.send('Device deleted successfully');
        });
    });
}); 

// Реєстрація нового користувача
app.post('/register', upload.none(), (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, existingUser) => {
    if (err) {
      return res.status(500).send(err.message);
    }

    if (existingUser) {
      return res.status(400).send('User already exists');
    }

    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
        return res.status(500).send(err.message);
      }

      db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function (err) {
        if (err) {
          return res.status(500).send(err.message);
        }

        res.status(201).send('User registered successfully');
      });
    });
  });
});

// Отримання списку зареєстрованих користувачів
app.get('/users', (req, res) => {
  db.all('SELECT * FROM users', (err, users) => {
    if (err) {
      return res.status(500).send(err.message);
    }

    res.json(users);
  });
});

// Взяття пристрою у користування
app.put('/devices/:id/take', (req, res) => {
  const deviceId = req.params.id;
  const { username } = req.body;

  db.get('SELECT * FROM devices WHERE id = ? AND username IS NULL', [deviceId], (err, device) => {
    if (err) {
      return res.status(500).send(err.message);
    }

    if (!device) {
      return res.status(404).send('Device not available or already taken');
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (err) {
        return res.status(500).send(err.message);
      }

      if (!user) {
        return res.status(404).send('User not found');
      }

      db.run('UPDATE devices SET username = ? WHERE id = ?', [username, deviceId], function (err) {
        if (err) {
          return res.status(500).send(err.message);
        }

        res.send('Device taken by user');
      });
    });
  });
}); 

// Повернення пристрою на зберігання
app.put('/devices/:id/return', (req, res) => {
  const deviceId = req.params.id;
  const { username } = req.body;

  db.get('SELECT * FROM devices WHERE id = ? AND username IS NOT NULL', [deviceId], (err, device) => {
    if (err) {
      return res.status(500).send(err.message);
    }

    if (!device) {
      return res.status(404).send('Device not taken by any user');
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (err) {
        return res.status(500).send(err.message);
      }

      if (!user) {
        return res.status(404).send('User not found');
      }

      if (device.username !== username) {
        return res.status(403).send('You are not allowed to return this device');
      }

      db.run('UPDATE devices SET username = NULL WHERE id = ?', [deviceId], function (err) {
        if (err) {
          return res.status(500).send(err.message);
        }

        res.send('Device returned to storage');
      });
    });
  });
});

// Список пристроїв у користуванні для кожного користувача
app.get('/users/:username/devices', upload.none(), (req, res) => {
  const username = req.params.username;

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).send(err.message);
    }

    if (!user) {
      return res.status(404).send('User not found');
    }

    db.all('SELECT * FROM devices WHERE username = ?', [username], (err, userDevices) => {
      if (err) {
        return res.status(500).send(err.message);
      }

      res.json(userDevices);
    });
  });
});

// Завантаження Swagger/OpenAPI документа з файлу openapi.yaml
const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));

// Використання Swagger UI на шляху /api
app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
