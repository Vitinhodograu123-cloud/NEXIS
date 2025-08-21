const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const bodyParser = require("body-parser");
const fs = require('fs'); // apenas aqui!

const logAction = (msg) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync('logs.txt', `[${timestamp}] ${msg}\n`);
};
const app = express();
const db = new sqlite3.Database("./database.db");

app.use(bodyParser.json());
app.use(express.static("public"));

// --- Tabelas ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    ip TEXT NOT NULL,
    login TEXT NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    registration TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    salt TEXT,
    equipId INTEGER,
    blocked INTEGER DEFAULT 0
  )`);

  // Adiciona a coluna blocked se ela não existir
  db.run("ALTER TABLE users ADD COLUMN blocked INTEGER DEFAULT 0", (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Erro ao adicionar coluna blocked:', err);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    portal_id TEXT,
    event_type TEXT,
    timestamp INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    template TEXT,
    template_size INTEGER,
    finger_type INTEGER
  )`)

  db.run(`
  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    registration TEXT NOT NULL,
    password TEXT NOT NULL,
    salt TEXT,
    equipId INTEGER,
    begin_time INTEGER,
    end_time INTEGER
  )
`);

});

// Gerenciamento de múltiplos terminais
let terminalSessions = new Map(); // Map para armazenar sessões de todos os terminais

// Função para conectar a todos os terminais automaticamente
async function connectToAllTerminals() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM terminals", [], async (err, terminals) => {
      if (err) {
        reject(err);
        return;
      }

      const connectionPromises = terminals.map(async (terminal) => {
        try {
          const response = await axios.post(`http://${terminal.ip}/login.fcgi`, {
            login: terminal.login,
            password: terminal.password
          });
          
          if (response.data.session) {
            terminalSessions.set(terminal.id, {
              terminal: terminal,
              session: response.data.session
            });
            logAction(`Conectado ao terminal ${terminal.name} (${terminal.ip})`);
            return { success: true, terminal: terminal };
          } else {
            logAction(`Falha ao conectar ao terminal ${terminal.name} (${terminal.ip})`);
            return { success: false, terminal: terminal, error: 'No session returned' };
          }
        } catch (error) {
          logAction(`Erro ao conectar ao terminal ${terminal.name} (${terminal.ip}): ${error.message}`);
          return { success: false, terminal: terminal, error: error.message };
        }
      });

      try {
        const results = await Promise.all(connectionPromises);
        const successful = results.filter(r => r.success);
        logAction(`Conectado a ${successful.length} de ${terminals.length} terminais`);
        resolve(results);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Função para fazer requisição para todos os terminais
async function makeRequestToAllTerminals(endpoint, method = 'GET', data = null) {
  const results = [];
  
  for (const [terminalId, sessionData] of terminalSessions) {
    try {
      const url = `http://${sessionData.terminal.ip}/${endpoint}.fcgi?session=${sessionData.session}`;
      const response = await axios({
        method,
        url,
        data
      });
      results.push({
        terminalId: terminalId,
        terminalName: sessionData.terminal.name,
        success: true,
        data: response.data
      });
    } catch (error) {
      results.push({
        terminalId: terminalId,
        terminalName: sessionData.terminal.name,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

// Função para fazer requisição para um terminal específico
async function makeTerminalRequest(terminalId, endpoint, method = 'GET', data = null) {
  const sessionData = terminalSessions.get(terminalId);
  if (!sessionData) {
    throw new Error(`Terminal ${terminalId} não está conectado`);
  }

  try {
    const url = `http://${sessionData.terminal.ip}/${endpoint}.fcgi?session=${sessionData.session}`;
    const response = await axios({
      method,
      url,
      data
    });
    return response.data;
  } catch (error) {
    console.error(`Terminal request error for ${sessionData.terminal.name}:`, error.message);
    throw error;
  }
}

// Conectar a todos os terminais na inicialização
connectToAllTerminals().then(() => {
  console.log('Conexões iniciais estabelecidas');
}).catch(error => {
  console.error('Erro ao conectar terminais:', error);
});

// Reconectar periodicamente (a cada 5 minutos)
setInterval(() => {
  connectToAllTerminals().catch(error => {
    console.error('Erro na reconexão periódica:', error);
  });
}, 5 * 60 * 1000);

// --- Terminais ---
app.get("/terminals", async (req, res) => {
  db.all("SELECT * FROM terminals", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post("/terminals", async (req, res) => {
  const { name, ip, login, password } = req.body;
  
  try {
    // Testa a conexão antes de salvar
    const response = await axios.post(`http://${ip}/login.fcgi`, {
      login: login,
      password: password
    });
    
    if (!response.data.session) {
      return res.status(400).json({ error: "Credenciais inválidas" });
    }
    
    db.run("INSERT INTO terminals (name, ip, login, password) VALUES (?, ?, ?, ?)", 
      [name, ip, login, password], function (err) {
      if (err) return res.status(500).send(err.message);
      
      // Conecta automaticamente ao novo terminal
      const newTerminal = { id: this.lastID, name, ip, login, password };
      terminalSessions.set(this.lastID, {
        terminal: newTerminal,
        session: response.data.session
      });
      
      res.json({ id: this.lastID });
    });
  } catch (error) {
    res.status(400).json({ error: "Não foi possível conectar ao terminal: " + error.message });
  }
});

app.put("/terminals/:id", async (req, res) => {
  const { name, ip, login, password } = req.body;
  
  try {
    // Testa a nova conexão
    const response = await axios.post(`http://${ip}/login.fcgi`, {
      login: login,
      password: password
    });
    
    if (!response.data.session) {
      return res.status(400).json({ error: "Credenciais inválidas" });
    }
    
    db.run("UPDATE terminals SET name=?, ip=?, login=?, password=? WHERE id=?", 
      [name, ip, login, password, req.params.id], function (err) {
      if (err) return res.status(500).send(err.message);
      
      // Atualiza a sessão do terminal
      const updatedTerminal = { id: parseInt(req.params.id), name, ip, login, password };
      terminalSessions.set(parseInt(req.params.id), {
        terminal: updatedTerminal,
        session: response.data.session
      });
      
      res.json({ updated: true });
    });
  } catch (error) {
    res.status(400).json({ error: "Não foi possível conectar ao terminal: " + error.message });
  }
});

app.delete("/terminals/:id", (req, res) => {
  db.run("DELETE FROM terminals WHERE id=?", [req.params.id], function (err) {
    if (err) return res.status(500).send(err.message);
    
    // Remove a sessão do terminal
    terminalSessions.delete(parseInt(req.params.id));
    
    res.json({ deleted: true });
  });
});

// --- Status dos terminais ---
app.get("/terminals/status", (req, res) => {
  const status = [];
  
  for (const [terminalId, sessionData] of terminalSessions) {
    status.push({
      id: terminalId,
      name: sessionData.terminal.name,
      ip: sessionData.terminal.ip,
      connected: true,
      session: sessionData.session
    });
  }
  
  res.json(status);
});

// --- Usuários ---
app.get("/users", (req, res) => {
  db.all("SELECT * FROM users", [], (err, rows) => res.json(rows));
});

app.post("/users", async (req, res) => {
  const { name, registration, password, salt } = req.body;
  
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal conectado" });
  }
  
  try {
    const results = await makeRequestToAllTerminals('create_objects', 'POST', {
      object: "users", 
      values: [{ name, registration, password, salt }]
    });
    
    // Usa o primeiro resultado bem-sucedido para obter o equipId
    const successfulResult = results.find(r => r.success);
    if (!successfulResult) {
      return res.status(500).json({ error: "Falha ao criar usuário em todos os terminais" });
    }
    
    const equipId = successfulResult.data.ids?.[0] || null;
    
    // Cria o usuário no banco local
    db.run("INSERT INTO users (name, registration, password, salt, equipId) VALUES (?,?,?,?,?)", 
      [name, registration, password, salt, equipId]);
    
    // Associa o usuário ao grupo liberado em todos os terminais
    await makeRequestToAllTerminals('create_objects', 'POST', {
      object: "user_groups",
      fields: ["user_id", "group_id"],
      values: [{
        user_id: equipId,
        group_id: 1 // Grupo 1 = liberado
      }]
    });
    
    res.json({ success: true, equipId, terminalsProcessed: results.length });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post("/visitors", async (req, res) => {
  logAction("==> [POST /visitors] Body recebido: " + JSON.stringify(req.body));

  if (terminalSessions.size === 0) {
    logAction("==> [ERRO] Nenhum terminal conectado.");
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }

  const { name, registration, password, begin_time, end_time } = req.body;
  logAction(`==> Dados recebidos: name=${name}, registration=${registration}, password=${password}, begin_time=${begin_time}, end_time=${end_time}`);

  if (!name || !registration || !password || !begin_time || !end_time) {
    logAction("==> [ERRO] Campos obrigatórios faltando.");
    return res.status(400).json({ success: false, error: "Preencha todos os campos." });
  }
  if (Number(begin_time) >= Number(end_time)) {
    logAction("==> [ERRO] begin_time >= end_time.");
    return res.status(400).json({ success: false, error: "A data de fim deve ser maior que a de início!" });
  }

  try {
    // 1. Gera o hash da senha utilizando a API da Control iD (primeiro terminal)
    logAction("==> Gerando hash da senha na Control iD...");
    const firstTerminal = Array.from(terminalSessions.values())[0];
    const hashResp = await axios.post(
      `http://${firstTerminal.terminal.ip}/user_hash_password.fcgi?session=${firstTerminal.session}`,
      { password },
      { headers: { "Content-Type": "application/json" } }
    );
    logAction("==> Resposta hash: " + JSON.stringify(hashResp.data));

    const hashedPassword = hashResp.data.password;
    const salt = hashResp.data.salt;

    // 2. Cria visitante em todos os equipamentos usando o hash e o salt
    logAction("==> Criando visitante em todos os equipamentos...");
    const createUserBody = {
      object: "users",
      values: [
        {
          name,
          registration,
          password: hashedPassword,
          salt,
          user_type_id: 1,
          begin_time,
          end_time
        }
      ]
    };
    logAction("==> Payload usuário: " + JSON.stringify(createUserBody));

    const results = await makeRequestToAllTerminals('create_objects', 'POST', createUserBody);
    const successfulResults = results.filter(r => r.success);
    
    if (successfulResults.length === 0) {
      logAction("==> [ERRO] Falha ao criar visitante em todos os terminais.");
      return res.status(500).json({ success: false, error: "Erro ao cadastrar visitante nos equipamentos." });
    }
    
    // Usa o primeiro resultado bem-sucedido para obter o equipId
    const equipId = successfulResults[0].data.ids?.[0] || null;
    if (!equipId) {
      logAction("==> [ERRO] Não foi retornado equipId do terminal.");
      return res.status(500).json({ success: false, error: "Erro ao cadastrar visitante no equipamento." });
    }

    // 3. Salva visitante no banco local
    logAction("==> Salvando visitante no banco local...");
    db.run(
      "INSERT INTO visitors (name, registration, password, salt, equipId, begin_time, end_time) VALUES (?,?,?,?,?,?,?)",
      [name, registration, hashedPassword, salt, equipId, begin_time, end_time],
      function(err) {
        if (err) {
          logAction("==> [ERRO] Falha ao inserir no banco: " + err.message);
          return res.status(500).json({ success: false, error: "Erro ao salvar visitante no banco: " + err.message });
        }

        // 4. Associa ao grupo de visitantes (group_id = 1) em todos os terminais
        logAction("==> Associando visitante ao grupo de visitantes em todos os terminais...");
        const groupPayload = {
          object: "user_groups",
          fields: ["user_id", "group_id"],
          values: [{ user_id: equipId, group_id: 1 }]
        };
        
        makeRequestToAllTerminals('create_objects', 'POST', groupPayload)
          .then(() => {
            logAction("==> Visitante cadastrado, salvo e associado ao grupo com sucesso em todos os terminais!");
            res.json({ success: true, equipId, terminalsProcessed: successfulResults.length });
          })
          .catch((e) => {
            logAction("==> [ERRO] Falha ao associar visitante ao grupo: " + e.message);
            res.status(500).json({ success: false, error: "Erro ao associar visitante ao grupo: " + e.message });
          });
      }
    );
  } catch (e) {
    logAction("==> [ERRO] Exceção geral: " + e.message + (e.response?.data ? " | DATA: " + JSON.stringify(e.response.data) : ""));
    res.status(500).json({ success: false, error: e.message, details: e.response?.data });
  }
});

// Endpoint para listar todos os visitantes
app.get("/visitors/list", (req, res) => {
  db.all("SELECT * FROM visitors", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Endpoint para buscar um visitante específico (para edição)
app.get("/visitors/:id", (req, res) => {
  db.get("SELECT * FROM visitors WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Visitante não encontrado" });
    res.json(row);
  });
});

// Endpoint para atualizar visitante
app.put("/visitors/:id", (req, res) => {
  const { name, registration, password, begin_time, end_time } = req.body;
  db.run(
    "UPDATE visitors SET name=?, registration=?, password=?, begin_time=?, end_time=? WHERE id=?",
    [name, registration, password, begin_time, end_time, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Endpoint para deletar visitante
app.delete("/visitors/:id", (req, res) => {
  db.run("DELETE FROM visitors WHERE id=?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/users/:id", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  const { name, registration, password, salt } = req.body;
  db.get("SELECT * FROM users WHERE id=?", [req.params.id], async (err, user) => {
    if (!user) return res.status(404).send("Usuário não encontrado");
    try {
      const results = await makeRequestToAllTerminals('modify_objects', 'POST', {
        object: "users",
        values: { name, registration, password, salt },
        where: { users: { id: user.equipId } }
      });
      
      const successfulResults = results.filter(r => r.success);
      if (successfulResults.length === 0) {
        return res.status(500).json({ error: "Falha ao atualizar usuário em todos os terminais" });
      }
      
      db.run("UPDATE users SET name=?, registration=?, password=?, salt=? WHERE id=?", [name, registration, password, salt, req.params.id]);
      res.json({ success: true, terminalsProcessed: successfulResults.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// User deletion routes
app.route('/users/:id')
  .delete(async (req, res) => {
    // Regular delete (from equipment and DB)
    if (terminalSessions.size === 0) {
      return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
    }
    db.get("SELECT * FROM users WHERE id=?", [req.params.id], async (err, user) => {
      if (!user) return res.status(404).send("Usuário não encontrado");
      try {
        if (user.equipId) {
          const results = await makeRequestToAllTerminals('destroy_objects', 'POST', {
            object: "users",
            where: { users: { id: user.equipId } }
          });
          
          const successfulResults = results.filter(r => r.success);
          if (successfulResults.length === 0) {
            return res.status(500).json({ error: "Falha ao deletar usuário em todos os terminais" });
          }
        }
        db.run("DELETE FROM users WHERE id=?", [req.params.id]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  });

// Local delete (from DB only)
app.delete('/users/:id/local', (req, res) => {
  console.log('Deleting user locally:', req.params.id);
  db.get("SELECT * FROM users WHERE id=?", [req.params.id], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    if (!user) {
      console.log('User not found:', req.params.id);
      return res.status(404).json({ success: false, error: "Usuário não encontrado" });
    }
    db.run("DELETE FROM users WHERE id=?", [req.params.id], (err) => {
      if (err) {
        console.error('Delete error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
      console.log('User deleted successfully:', req.params.id);
      res.json({ success: true });
    });
  });
});

// --- Biometria ---
app.post("/biometry/:userId", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  db.get("SELECT * FROM users WHERE id=?", [req.params.userId], async (err, user) => {
    if (!user || !user.equipId) return res.status(404).send("Usuário sem equipId");
    try {
      // Inicia cadastro de biometria no primeiro terminal disponível
      const firstTerminal = Array.from(terminalSessions.values())[0];
      const response = await axios.post(`http://${firstTerminal.terminal.ip}/remote_enroll.fcgi?session=${firstTerminal.session}`, {
        type: "biometry", user_id: user.equipId, save: true, sync: true, panic_finger: 0
      }, { headers: { "Content-Type": "application/json" } });
      res.json({ success: true, terminal: firstTerminal.terminal.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

app.post("/biometry/template/:userId", (req, res) => {
  const { template, template_size, finger_type } = req.body;
  const userId = req.params.userId;
  db.run(
    "UPDATE users SET template = ? WHERE id = ?",
    [template, userId],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true });
    }
  );
});

app.post("/biometry/visitor/:visitorId", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  db.get("SELECT * FROM visitors WHERE id=?", [req.params.visitorId], async (err, visitor) => {
    if (!visitor || !visitor.equipId) return res.status(404).send("Visitante sem equipId");
    try {
      // Inicia cadastro de biometria no primeiro terminal disponível
      const firstTerminal = Array.from(terminalSessions.values())[0];
      const response = await axios.post(`http://${firstTerminal.terminal.ip}/remote_enroll.fcgi?session=${firstTerminal.session}`, {
        type: "biometry", user_id: visitor.equipId, save: true, sync: true, panic_finger: 0
      }, { headers: { "Content-Type": "application/json" } });
      res.json({ success: true, terminal: firstTerminal.terminal.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// --- Obter IDs ---
app.post("/get_ids", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  try {
    // Usa o primeiro terminal disponível para obter os IDs
    const firstTerminal = Array.from(terminalSessions.values())[0];
    const resp = await axios.post(`http://${firstTerminal.terminal.ip}/load_objects.fcgi?session=${firstTerminal.session}`, { object: "users" }, { headers: { "Content-Type": "application/json" } });
    const equipUsers = resp.data.users || [];
    for (const eu of equipUsers) db.run("UPDATE users SET equipId=? WHERE name=?", [eu.id, eu.name]);
    res.json({ success: true, users: equipUsers, terminal: firstTerminal.terminal.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Deletar todos usuários do equipamento ---
app.post("/users/delete_all", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  try {
    const results = await makeRequestToAllTerminals('destroy_objects', 'POST', { object: "users" });
    const successfulResults = results.filter(r => r.success);
    res.json({ success: true, terminalsProcessed: successfulResults.length, totalTerminals: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Apagar todos usuários do banco ---
app.post("/users/clear_db", async (req, res) => {
  db.run("DELETE FROM users", () => res.json({ success: true }));
});

// --- Configurações Avançadas ---
// Reiniciar equipamento
app.post("/terminal/reboot", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  try {
    const results = await makeRequestToAllTerminals('reboot', 'POST');
    const successfulResults = results.filter(r => r.success);
    res.json({ success: true, terminalsProcessed: successfulResults.length, totalTerminals: results.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Reset de fábrica (exceto rede)
app.post("/terminal/factory-reset", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  try {
    const results = await makeRequestToAllTerminals('reset_to_factory_default', 'POST', {});
    const successfulResults = results.filter(r => r.success);
    res.json({ success: true, terminalsProcessed: successfulResults.length, totalTerminals: results.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Alterar senha mestre
app.post("/terminal/master-password", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, error: "Senha não fornecida" });

  try {
    const results = await makeRequestToAllTerminals('master_password', 'POST', { password });
    const successfulResults = results.filter(r => r.success);
    res.json({ success: true, terminalsProcessed: successfulResults.length, totalTerminals: results.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Alterar configuração de rede
app.post("/terminal/network", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  const { ip, netmask, gateway, web_server_port } = req.body;

  try {
    const results = await makeRequestToAllTerminals('set_system_network', 'POST', { ip, netmask, gateway, web_server_port });
    const successfulResults = results.filter(r => r.success);
    
    // Atualizar IP no banco de dados para todos os terminais bem-sucedidos
    for (const result of successfulResults) {
      await new Promise((resolve, reject) => {
        db.run("UPDATE terminals SET ip = ? WHERE id = ?", [ip, result.terminalId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    res.json({ success: true, terminalsProcessed: successfulResults.length, totalTerminals: results.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Abrir secbox
app.post("/terminal/open-secbox", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).send("Nenhum terminal conectado. Conecte-se a um terminal primeiro.");
  }
  try {
    const results = await makeRequestToAllTerminals('execute_actions', 'POST', {
      actions: [{
        action: "sec_box",
        parameters: "id=65793,reason=3,timeout=3000"
      }]
    });
    const successfulResults = results.filter(r => r.success);
    res.json({ success: true, terminalsProcessed: successfulResults.length, totalTerminals: results.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Logout ---
app.post("/logout", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.json({ success: true });
  }
  try {
    const results = await makeRequestToAllTerminals('logout', 'POST');
    terminalSessions.clear();
    res.json({ success: true, terminalsProcessed: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Endpoint para obter status de todos os terminais
app.get("/terminals/status", (req, res) => {
  const status = [];
  
  for (const [terminalId, sessionData] of terminalSessions) {
    status.push({
      id: terminalId,
      name: sessionData.terminal.name,
      ip: sessionData.terminal.ip,
      connected: true,
      session: sessionData.session
    });
  }
  
  res.json(status);
});

// --- Terminal Configuration Endpoints ---
app.post("/terminal/:id/reboot", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }
  try {
    await makeTerminalRequest('reboot', 'POST');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/terminal/:id/factory-reset", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }
  try {
    await makeTerminalRequest('reset_to_factory_default', 'POST', {
      keep_network_info: true
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/terminal/:id/master-password", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }
  try {
    const { password } = req.body;
    await makeTerminalRequest('master_password', 'POST', {
      password
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/terminal/:id/network-config", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }
  try {
    const { ip, mask, gateway } = req.body;
    await makeTerminalRequest('set_system_network', 'POST', {
      ip,
      netmask: mask,
      gateway,
      web_server_port: 80
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/terminal/:id/open-secbox", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }
  try {
    await makeTerminalRequest('execute_actions', 'POST', {
      actions: [
        {
          action: "sec_box",
          parameters: "id=65793,reason=3,timeout=3000"
        }
      ]
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Monitor Endpoints ---
app.post("/api/notifications/dao", (req, res) => {
  const event = req.body;
  console.log('Received access event:', event);

  // Se for um evento de acesso
  if (event.object_changes && event.object_changes[0].object === "access_logs") {
    const access = event.object_changes[0].values;

    // Buscar usuário pelo equipId
    db.get("SELECT * FROM users WHERE equipId = ?", [access.user_id], (err, user) => {
      let userData = {
        id: null,
        name: 'Usuário bloqueado ou não cadastrado no banco de dados!'
      };

      if (user) {
        userData = {
          id: user.id,
          name: user.name
        };
      }

      // Determinar o tipo de acesso baseado no evento
      let accessType;

      // Log os detalhes do evento para debug
      console.log('Access event details:', {
        event: access.event,
        cause: access.cause,
        operation: access.operation,
        userData
      });

      // Interpretar o evento (7 = liberado, 6 = negado)
      if (access.event === '7') {
        accessType = 'authorized';
      } else if (access.event === '6') {
        accessType = 'denied';
      } else {
        accessType = 'unknown';
      }

      // Usar o horário atual do servidor
      const currentTimestamp = Math.floor(Date.now() / 1000);

      // Salvar o log no banco
      db.run(
        `INSERT INTO access_logs (user_id, user_name, portal_id, event_type, timestamp) 
         VALUES (?, ?, ?, ?, ?)`,
        [userData.id, userData.name, access.portal_id, accessType, currentTimestamp],
        function (err) {
          if (err) {
            console.error('Erro ao salvar log:', err);
          } else {
            console.log('Log salvo com sucesso, ID:', this.lastID);
          }
        }
      );

      // Emitir evento para o frontend via SSE com informações adicionais
      clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify({
          type: 'access',
          data: {
            ...access,
            user_id: userData.id,
            user_name: userData.name,
            accessType,
            time: currentTimestamp, // Usando o horário atual do servidor
            details: {
              event: access.event,
              cause: access.cause,
              operation: access.operation
            }
          }
        })}\n\n`);
      });
    });
  }

  if (event.object_changes && event.object_changes[0].object === "templates") {
    const tpl = event.object_changes[0].values;
    logAction("Recebido objeto template: " + JSON.stringify(tpl));

    db.get("SELECT id FROM users WHERE equipId = ?", [tpl.user_id], (err, user) => {
      if (err) {
        logAction("Erro ao buscar user pelo equipId " + tpl.user_id + ": " + err.message);
        return;
      }
      if (user) {
        db.run(
          `INSERT INTO templates (user_id, template, template_size, finger_type)
           VALUES (?, ?, ?, ?)`,
          [user.id, tpl.template, tpl.template_size, tpl.finger_type],
          function (err2) {
            if (err2) {
              logAction("Erro ao salvar template no banco: " + err2.message);
            } else {
              logAction("Template salvo com sucesso para user_id=" + user.id + " (rowid=" + this.lastID + ")");
            }
          }
        );
      } else {
        logAction("Não encontrou usuário local para equipId=" + tpl.user_id + ". Não salvou template.");
      }
    });
  }

  res.json({ success: true });
});

// Server-Sent Events (SSE) endpoint
let clients = [];
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = {
    id: Date.now(),
    res
  };

  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== client.id);
  });
});

// Endpoint para configurar o monitor no terminal
// --- Logs de Acesso ---
app.post('/access-logs', (req, res) => {
  const { user_id, user_name, portal_id, event_type, timestamp } = req.body;

  db.run(
    `INSERT INTO access_logs (user_id, user_name, portal_id, event_type, timestamp) 
     VALUES (?, ?, ?, ?, ?)`,
    [user_id, user_name, portal_id, event_type, timestamp],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao salvar log de acesso' });
      } else {
        res.json({ success: true });
      }
    }
  );
});

app.get('/access-logs', (req, res) => {
  const date = req.query.date;
  const startTime = new Date(date);
  const endTime = new Date(date);
  endTime.setDate(endTime.getDate() + 1);

  db.all(
    `SELECT * FROM access_logs 
     WHERE timestamp >= ? AND timestamp < ?
     ORDER BY timestamp DESC`,
    [startTime.getTime() / 1000, endTime.getTime() / 1000],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar logs de acesso' });
      } else {
        res.json(rows);
      }
    }
  );
});

app.post("/terminal/:id/configure-monitor", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }
  try {
    await makeTerminalRequest('set_configuration', 'POST', {
      monitor: {
        request_timeout: "5000",
        hostname: req.body.hostname || "192.168.100.210",
        port: req.body.port || "3000",
        path: "api/notifications"
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rota para enviar todos os usuários do banco para o terminal
// Rota para alternar o status de bloqueio de um usuário

app.post("/users/:id/toggle_block", async (req, res) => {
  if (terminalSessions.size === 0) {
    logAction("toggle_block: Nenhum terminal selecionado");
    return res.status(400).json({ error: "Nenhum terminal selecionado" });
  }

  const userId = req.params.id;

  db.get("SELECT * FROM users WHERE id = ?", [userId], async (err, user) => {
    if (err) {
      logAction(`toggle_block: Erro ao buscar usuário id=${userId} - ${err.message}`);
      return res.status(500).json({ error: "Erro ao buscar usuário" });
    }
    if (!user) {
      logAction(`toggle_block: Usuário não encontrado id=${userId}`);
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    try {
      if (user.blocked) {
        // --- DESBLOQUEIO ---
        logAction(`toggle_block: Desbloqueando usuário id=${userId}, name=${user.name}`);

        // 1. Recria usuário em todos os terminais
        const results = await makeRequestToAllTerminals('create_objects', 'POST', {
          object: "users",
          values: [{
            name: user.name,
            registration: user.registration,
            password: user.password,
            salt: user.salt || ""
          }]
        });
        
        const successfulResults = results.filter(r => r.success);
        if (successfulResults.length === 0) {
          logAction(`toggle_block: Falha ao recriar usuário em todos os terminais`);
          return res.status(500).json({ error: "Falha ao recriar usuário em todos os terminais" });
        }
        
        // Usa o primeiro resultado bem-sucedido para obter o equipId
        const equipId = successfulResults[0].data.ids?.[0] || user.equipId || user.id;
        logAction(`toggle_block: RESPOSTA USUARIO=${JSON.stringify(successfulResults[0].data)}`);

        // 2. Atualiza equipId no banco local se mudou
        if (!user.equipId || user.equipId !== equipId) {
          logAction(`toggle_block: Atualizando equipId para ${equipId} no banco`);
          await new Promise((resolve, reject) => {
            db.run("UPDATE users SET equipId = ? WHERE id = ?", [equipId, userId], (err) => {
              if (err) reject(err); else resolve();
            });
          });
        }

        // 3. Remove associações antigas de grupo em todos os terminais
        try {
          await makeRequestToAllTerminals('destroy_objects', 'POST', {
            object: "user_groups",
            where: { user_id: equipId }
          });
        } catch (e) {
          logAction(`toggle_block: Erro ao remover grupo antigo (ignorado): ${e.message}`);
        }

        // 4. Associa ao grupo 1 (liberado) em todos os terminais
        await makeRequestToAllTerminals('create_objects', 'POST', {
          object: "user_groups",
          fields: ["user_id", "group_id"],
          values: [{
            user_id: equipId,
            group_id: 1
          }]
        });

        // 5. Busca e envia todos os templates desse usuário para todos os terminais
        db.all('SELECT * FROM templates WHERE user_id = ?', [userId], async (err, templates) => {
          if (!err && templates && templates.length > 0) {
            db.get('SELECT equipId FROM users WHERE name = ?', [user.name], async (err2, row) => {
              if (!err2 && row && row.equipId) {
                for (const tpl of templates) {
                  try {
                    await makeRequestToAllTerminals('create_objects', 'POST', {
                      object: "templates",
                      values: [{
                        user_id: row.equipId,
                        template: tpl.template,
                        finger_type: tpl.finger_type
                      }]
                    });
                    logAction(`toggle_block: Template enviado para todos os terminais`);
                  } catch (errSend) {
                    logAction(`toggle_block: ERRO ao enviar template: ${errSend.message}`);
                  }
                }
              } else {
                logAction('toggle_block: Não foi possível encontrar equipId atualizado para o usuário na tabela users.');
              }
              db.run("UPDATE users SET blocked = 0 WHERE id = ?", [userId], (updateErr) => {
                if (updateErr) {
                  logAction('toggle_block: Falha ao atualizar status de desbloqueio local');
                  return res.status(500).json({ error: "Falha ao atualizar status de desbloqueio local" });
                }
                logAction('toggle_block: Usuário desbloqueado com sucesso');
                res.json({ success: true, message: "Usuário desbloqueado, reenviado ao equipamento, grupo liberado e biometria enviada" });
              });
            });
          } else {
            db.run("UPDATE users SET blocked = 0 WHERE id = ?", [userId], (updateErr) => {
              if (updateErr) {
                logAction('toggle_block: Falha ao atualizar status de desbloqueio local');
                return res.status(500).json({ error: "Falha ao atualizar status de desbloqueio local" });
              }
              logAction('toggle_block: Usuário desbloqueado e reenviado ao equipamento (sem template)');
              res.json({ success: true, message: "Usuário desbloqueado e reenviado ao equipamento" });
            });
          }
        });

      } else {
        // --- BLOQUEIO ---
        if (user.equipId) {
          const results = await makeRequestToAllTerminals('destroy_objects', 'POST', {
            object: "users",
            where: { users: { id: user.equipId } }
          });
          const successfulResults = results.filter(r => r.success);
          logAction(`toggle_block: Usuário removido de ${successfulResults.length} terminais`);
        }
        db.run("UPDATE users SET blocked = 1 WHERE id = ?", [userId], (updateErr) => {
          if (updateErr) {
            logAction('toggle_block: Falha ao atualizar status de bloqueio local');
            return res.status(500).json({ error: "Falha ao atualizar status de bloqueio local" });
          }
          logAction('toggle_block: Usuário removido do equipamento e marcado como bloqueado no sistema');
          res.json({ success: true, message: "Usuário removido do equipamento e marcado como bloqueado no sistema" });
        });
      }
    } catch (error) {
      logAction(`toggle_block: ERRO GERAL: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });
});

// Endpoint para buscar os templates do terminal e salvar no banco local
app.post("/obter-biometrias", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ success: false, error: "Nenhum terminal conectado" });
  }

  try {
    // 1. Faz a requisição pro primeiro terminal para pegar os templates
    const firstTerminal = Array.from(terminalSessions.values())[0];
    const url = `http://${firstTerminal.terminal.ip}/load_objects.fcgi?session=${firstTerminal.session}`;
    const response = await axios.post(url, { object: "templates" }, { headers: { "Content-Type": "application/json" } });

    const templates = response.data.templates || [];
    if (templates.length === 0) {
      return res.json({ success: true, message: "Nenhuma biometria encontrada no terminal." });
    }

    // 2. Para cada template, salva no banco local, associando ao user_id (equipId)
    let count = 0;
    for (const tpl of templates) {
      // Busca o usuário local correspondente ao equipId (user_id do template)
      db.get("SELECT id FROM users WHERE equipId = ?", [tpl.user_id], (err, user) => {
        if (user) {
          db.run(
            `INSERT OR REPLACE INTO templates (user_id, template, template_size, finger_type)
             VALUES (?, ?, ?, ?)`,
            [user.id, tpl.template, tpl.template?.length || null, tpl.finger_type || tpl.finger_position || 0]
          );
        }
      });
      count++;
    }

    res.json({ success: true, message: `${count} biometrias importadas do terminal ${firstTerminal.terminal.name}.` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/users/send_all", async (req, res) => {
  if (terminalSessions.size === 0) {
    return res.status(400).json({ error: "Nenhum terminal conectado" });
  }

  try {
    // Busca todos os usuários do banco
    const users = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM users", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    let totalProcessed = 0;
    let totalErrors = 0;

    // Para cada usuário, envia para todos os terminais
    for (const user of users) {
      try {
        // Adiciona um pequeno delay entre as requisições
        await new Promise(resolve => setTimeout(resolve, 300));

        // Primeiro envia o usuário para todos os terminais
        const userResults = await makeRequestToAllTerminals('create_objects', 'POST', {
          object: "users",
          values: [{
            name: user.name,
            registration: user.registration,
            password: user.password,
            salt: user.salt || ""
          }]
        });

        const successfulUserResults = userResults.filter(r => r.success);
        if (successfulUserResults.length > 0) {
          // Usa o primeiro resultado bem-sucedido para obter o equipId
          const equipId = successfulUserResults[0].data.ids?.[0] || user.equipId || user.id;

          // Associa ao grupo apropriado em todos os terminais
          await makeRequestToAllTerminals('create_objects', 'POST', {
            object: "user_groups",
            fields: ["user_id", "group_id"],
            values: [{
              user_id: equipId,
              group_id: user.blocked ? 3 : 1 // Se bloqueado usa 3, senão usa 1
            }]
          });

          // Se o usuário não tem equipId, atualiza com o ID usado
          if (!user.equipId) {
            await new Promise((resolve, reject) => {
              db.run(
                "UPDATE users SET equipId = ? WHERE id = ?",
                [equipId, user.id],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }

          totalProcessed++;
        } else {
          totalErrors++;
        }
      } catch (error) {
        console.error(`Erro ao enviar usuário ${user.name}:`, error);
        totalErrors++;
      }
    }

    res.json({ 
      success: true, 
      message: `${totalProcessed} usuários enviados com sucesso para todos os terminais`,
      totalProcessed,
      totalErrors,
      totalTerminals: terminalSessions.size
    });
  } catch (error) {
    console.error('Erro ao enviar usuários:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log("Servidor rodando em http://localhost:3000"));
