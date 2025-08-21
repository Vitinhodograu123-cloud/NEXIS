// Sistema de múltiplos terminais - não há mais seleção manual
let terminalStatus = [];

// --- Helpers ---
function showMessage(msg, error = false, showSuccessModal = false) {
    const messageElement = document.getElementById('message');
    messageElement.textContent = msg;
    messageElement.className = error ? 'message-error show' : 'message-success show';
    
    if (!error && msg !== 'Operação cancelada.' && showSuccessModal) {
        showModal('Sucesso', `
            <p>${msg}</p>
            <div style="text-align: right; margin-top: 20px;">
                <button onclick="closeModal()" class="btn">Fechar</button>
            </div>
        `);
    }
    
    setTimeout(() => {
        messageElement.classList.remove('show');
    }, 5000);
}

function showError(msg) {
    showMessage(msg, true);
}

function showConfirmationModal(title, message, onConfirm) {
    const content = `
        <p>${message}</p>
        <div style="text-align: right; margin-top: 20px;">
            <button onclick="closeModal()" class="btn">Cancelar</button>
            <button onclick="handleConfirm()" class="btn-delete" style="margin-left: 10px;">Confirmar</button>
        </div>
    `;
    showModal(title, content);
    window.handleConfirm = () => {
        closeModal();
        onConfirm();
        delete window.handleConfirm;
    };
}
// Carregar lista de visitantes ao abrir a página
async function loadVisitors() {
  const tbody = document.getElementById("visitors-list");
  tbody.innerHTML = "<tr><td colspan='5'>Carregando...</td></tr>";
  const resp = await fetch("/visitors/list");
  const visitors = await resp.json();
  tbody.innerHTML = "";
  visitors.forEach(v => {
    tbody.innerHTML += `
      <tr>
        <td>${v.name}</td>
        <td>${v.registration}</td>
        <td>${v.begin_time ? new Date(v.begin_time*1000).toLocaleString() : ""}</td>
        <td>${v.end_time ? new Date(v.end_time*1000).toLocaleString() : ""}</td>
        <td>
          <button onclick="openEditVisitor(${v.id})">Editar</button>
          <button onclick="deleteVisitor(${v.id})">Excluir</button>
          <button onclick="openBiometryVisitor(${v.id})">Biometria</button>
        </td>
      </tr>
    `;
  });
}

// Modal: abrir para novo visitante
function showVisitorModal() {
  document.getElementById("visitor-modal").style.display = "block";
  document.getElementById("visitor-form").reset();
  document.getElementById("visitor-id").value = "";
  document.getElementById("register-bio-visitor-btn").classList.add("hidden");
  document.getElementById("visitor-msg-modal").textContent = "";
}

// Modal: fechar
function closeVisitorModal() {
  document.getElementById("visitor-modal").style.display = "none";
}

// Modal: abrir para editar
async function openEditVisitor(id) {
  const resp = await fetch(`/visitors/${id}`);
  const v = await resp.json();
  showVisitorModal();
  document.getElementById("visitor-id").value = v.id;
  document.getElementById("visitor-name").value = v.name;
  document.getElementById("visitor-registration").value = v.registration;
  document.getElementById("visitor-password").value = ""; // nunca mostre senha!
  document.getElementById("visitor-begin").value = v.begin_time ? (new Date(v.begin_time*1000)).toISOString().slice(0,16) : "";
  document.getElementById("visitor-end").value = v.end_time ? (new Date(v.end_time*1000)).toISOString().slice(0,16) : "";
  document.getElementById("register-bio-visitor-btn").classList.remove("hidden");
}

// CRUD: criar/editar visitante
document.getElementById("visitor-form").onsubmit = async function(e) {
  e.preventDefault();
  const id = document.getElementById("visitor-id").value;
  const name = document.getElementById("visitor-name").value.trim();
  const registration = document.getElementById("visitor-registration").value.trim();
  const password = document.getElementById("visitor-password").value.trim();
  const begin_time = Date.parse(document.getElementById("visitor-begin").value) / 1000;
  const end_time = Date.parse(document.getElementById("visitor-end").value) / 1000;
  const msgEl = document.getElementById("visitor-msg-modal");

  if (!name || !registration || !password || !begin_time || !end_time) {
    msgEl.style.color = "red";
    msgEl.textContent = "Preencha todos os campos.";
    return;
  }
  if (begin_time >= end_time) {
    msgEl.style.color = "red";
    msgEl.textContent = "A data de fim deve ser maior!";
    return;
  }

  const payload = { name, registration, password, begin_time, end_time };
  let resp;
  if (id) {
    // Atualizar
    resp = await fetch(`/visitors/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    // Criar
    resp = await fetch("/visitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  if (resp.ok) {
    const data = await resp.json();
    msgEl.style.color = "green";
    const terminalInfo = data.terminalsProcessed ? ` em ${data.terminalsProcessed} terminais` : '';
    msgEl.textContent = `Salvo com sucesso${terminalInfo}!`;
    loadVisitors();
    setTimeout(closeVisitorModal, 1000);
  } else {
    const data = await resp.json();
    msgEl.style.color = "red";
    msgEl.textContent = "Erro: " + (data.error || "Não foi possível salvar.");
  }
};

// Excluir visitante
async function deleteVisitor(id) {
  if (!confirm("Excluir visitante?")) return;
  const resp = await fetch(`/visitors/${id}`, { method: "DELETE" });
  if (resp.ok) loadVisitors();
  else alert("Erro ao excluir visitante.");
}

// Modal: abrir cadastro de biometria
function openBiometryVisitor(id) {
  // Aqui pode abrir um modal, mas para exemplo, chama direto:
  if (confirm("Iniciar cadastramento remoto de biometria para este visitante?")) {
    registerVisitorBiometry(id);
  }
}

// Cadastrar biometria remota
async function registerVisitorBiometry(id) {
  const resp = await fetch(`/biometry/visitor/${id}`, { method: "POST" });
  const data = await resp.json();
  if (resp.ok && data.success) {
    const terminalInfo = data.terminal ? ` no terminal ${data.terminal}` : '';
    showMessage(`Biometria cadastrada com sucesso${terminalInfo}!`);
  } else {
    showError("Falha ao cadastrar biometria.");
  }
}

// Chamar ao abrir a página
window.onload = loadVisitors;


document.getElementById("btnObterBiometrias").onclick = async function() {
  if (!confirm("Deseja importar todas as biometrias do terminal para o sistema?")) return;
  const resp = await fetch("/obter-biometrias", { method: "POST" });
  const data = await resp.json();
  if (data.success) {
    showMessage(data.message || "Importação concluída!");
  } else {
    showError("Erro: " + (data.error || "Falha na importação"));
  }
};

async function fetchJSON(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        showError(`Erro na operação: ${error.message}`);
        throw error;
    }
}

// --- Terminais ---
async function checkTerminalStatus(terminal) {
  try {
    const response = await fetch(`http://${terminal.ip}/login.fcgi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: terminal.login,
        password: terminal.password
      })
    });
    return response.ok;
  } catch (error) {
    console.log(`Terminal ${terminal.name} offline:`, error.message);
    return false;
  }
}

async function loadTerminals() {
  const terminals = await fetchJSON("/terminals");
  const status = await fetchJSON("/terminals/status");
  const list = document.getElementById("terminals-list");
  list.innerHTML = "";
  
  // Atualiza o status global
  terminalStatus = status;
  
  for (const t of terminals) {
    const row = document.createElement("tr");
    
    const nameCell = document.createElement("td");
    nameCell.textContent = t.name;
    
    const ipCell = document.createElement("td");
    ipCell.textContent = t.ip;
    
    const statusCell = document.createElement("td");
    const isConnected = status.some(s => s.id === t.id && s.connected);
    const isOnline = await checkTerminalStatus(t);
    
    statusCell.textContent = isOnline ? (isConnected ? "Conectado" : "Online") : "Offline";
    statusCell.className = isOnline ? "status-connected" : "status-disconnected";
    
    const actionsCell = document.createElement("td");
    const actionButtons = document.createElement("div");
    actionButtons.className = "action-buttons";
    
    const editBtn = document.createElement("button");
    editBtn.textContent = "Editar";
    editBtn.className = "btn-edit";
    editBtn.onclick = () => editTerminal(t);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Excluir";
    deleteBtn.className = "btn-delete";
    deleteBtn.onclick = () => deleteTerminal(t.id);

    actionButtons.appendChild(editBtn);
    actionButtons.appendChild(deleteBtn);
    actionsCell.appendChild(actionButtons);

    row.appendChild(nameCell);
    row.appendChild(ipCell);
    row.appendChild(statusCell);
    row.appendChild(actionsCell);
    list.appendChild(row);
  }
  
  // Atualiza o indicador de terminais conectados
  const connectedCount = status.filter(s => s.connected).length;
  const totalCount = terminals.length;
  document.getElementById("current-terminal").textContent = 
    `${connectedCount} de ${totalCount} terminais conectados`;
}

function showTerminalModal(isEdit = false) {
  const modal = document.getElementById('terminal-modal');
  const form = document.getElementById('terminal-form');
  const title = document.querySelector('#terminal-modal .modal-title');
  
  title.textContent = isEdit ? 'Editar Terminal' : 'Cadastrar Terminal';
  modal.classList.add('show');
  
  // Setup form submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    await saveTerminal();
  };
}

function closeTerminalModal() {
  const modal = document.getElementById('terminal-modal');
  modal.classList.remove('show');
  clearTerminalForm();
}

function clearTerminalForm() {
  document.getElementById("terminal-id").value = "";
  document.getElementById("terminal-name").value = "";
  document.getElementById("terminal-ip").value = "";
  document.getElementById("terminal-login").value = "";
  document.getElementById("terminal-password").value = "";
}

async function saveTerminal(){
  const id = document.getElementById("terminal-id").value;
  const name = document.getElementById("terminal-name").value;
  const ip = document.getElementById("terminal-ip").value;
  const login = document.getElementById("terminal-login").value;
  const password = document.getElementById("terminal-password").value;

  const data = { name, ip, login, password };
  const isEdit = id !== "";
  
  try {
    await fetchJSON(isEdit ? `/terminals/${id}` : "/terminals", {
      method: isEdit ? "PUT" : "POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(data)
    });
    
    showMessage(`Terminal ${isEdit ? 'atualizado' : 'cadastrado'} e conectado automaticamente!`);
    closeTerminalModal();
    loadTerminals();
  } catch (error) {
    showError(`Erro ao ${isEdit ? 'atualizar' : 'cadastrar'} terminal`);
  }
}

async function editTerminal(terminal){
  document.getElementById("terminal-id").value = terminal.id;
  document.getElementById("terminal-name").value = terminal.name;
  document.getElementById("terminal-ip").value = terminal.ip;
  document.getElementById("terminal-login").value = terminal.login;
  document.getElementById("terminal-password").value = terminal.password;
  showTerminalModal(true);
}

async function deleteTerminal(id){
  showModal('Confirmar Exclusão', `
    <p>Tem certeza que deseja excluir este terminal?</p>
    <div class="action-buttons">
      <button onclick="confirmDeleteTerminal('${id}')" class="btn-delete">Excluir</button>
      <button onclick="closeModal(this)" class="btn-edit">Cancelar</button>
    </div>
  `);
}

async function confirmDeleteTerminal(id) {
  try {
    await fetchJSON(`/terminals/${id}`, { method: "DELETE" });
    showMessage("Terminal excluído com sucesso!");
    closeModal(document.querySelector('.modal button'));
    loadTerminals();
  } catch (error) {
    showError("Erro ao excluir terminal");
  }
}

// Função removida - não há mais seleção manual de terminal

// --- Usuários ---
async function loadUsers() {
  const users = await fetchJSON("/users");
  const list = document.getElementById("users-list");
  list.innerHTML = "";
  users.forEach(u => {
    const row = document.createElement("tr");
    
    const nameCell = document.createElement("td");
    nameCell.textContent = u.name;
    
    const regCell = document.createElement("td");
    regCell.textContent = u.registration;

    const statusCell = document.createElement("td");
    statusCell.textContent = u.blocked ? "Bloqueado" : "Liberado";
    statusCell.className = u.blocked ? "status-disconnected" : "status-connected";
    
    const actionsCell = document.createElement("td");
    const actionButtons = document.createElement("div");
    actionButtons.className = "action-buttons";

    const editBtn = document.createElement("button");
    editBtn.textContent = "Editar";
    editBtn.className = "btn-edit";
    editBtn.onclick = () => editUser(u);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Excluir";
    deleteBtn.className = "btn-delete";
    deleteBtn.onclick = () => deleteUser(u.id);

    const blockBtn = document.createElement("button");
    blockBtn.textContent = u.blocked ? "Desbloquear" : "Bloquear";
    blockBtn.className = u.blocked ? "btn-bio" : "btn-warning";
    blockBtn.onclick = () => toggleUserBlock(u.id, u.name, u.blocked);

    actionButtons.appendChild(editBtn);
    actionButtons.appendChild(deleteBtn);
    actionButtons.appendChild(blockBtn);
    actionsCell.appendChild(actionButtons);

    row.appendChild(nameCell);
    row.appendChild(regCell);
    row.appendChild(statusCell);
    row.appendChild(actionsCell);
    list.appendChild(row);
  });

  // Atualiza select de biometria
  const select = document.getElementById("biometry-user-select");
  select.innerHTML = "";
  users.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.name;
    select.appendChild(opt);
  });
}

function showUserModal(isEdit = false) {
  const modal = document.getElementById('user-modal');
  const form = document.getElementById('user-form');
  const title = document.querySelector('#user-modal .modal-title');
  const bioBtn = document.getElementById('register-bio-btn');
  
  title.textContent = isEdit ? 'Editar Usuário' : 'Cadastrar Usuário';
  bioBtn.classList.toggle('hidden', !isEdit);
  
  // Clear any previous form handlers
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  // Setup form submission
  newForm.onsubmit = async (e) => {
    e.preventDefault();
    await saveUser();
  };
  
  modal.classList.add('show');
}

function closeUserModal() {
  const modal = document.getElementById('user-modal');
  modal.classList.remove('show');
  clearUserForm();
  
  // Re-enable the form for future use
  const form = document.getElementById('user-form');
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  // Setup form submission for the new form
  newForm.onsubmit = async (e) => {
    e.preventDefault();
    await saveUser();
  };
}

function clearUserForm() {
  document.getElementById("user-id").value = "";
  document.getElementById("user-name").value = "";
  document.getElementById("user-registration").value = "";
  document.getElementById("user-password").value = "";
  document.getElementById("user-salt").value = "";
}

async function saveUser(){
  const id = document.getElementById("user-id").value;
  const name = document.getElementById("user-name").value;
  const registration = document.getElementById("user-registration").value;
  const password = document.getElementById("user-password").value;
  const salt = document.getElementById("user-salt").value;

  const data = { name, registration, password, salt };
  const isEdit = id !== "";
  
  const resp = await fetchJSON(isEdit ? `/users/${id}` : "/users", {
    method: isEdit ? "PUT" : "POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(data)
  });
  
  if(resp.success){
    const terminalInfo = resp.terminalsProcessed ? ` em ${resp.terminalsProcessed} terminais` : '';
    showMessage(`Usuário ${isEdit ? 'atualizado' : 'cadastrado'}${terminalInfo}!`);
    closeUserModal();
    loadUsers();
  } else showMessage(`Erro ao ${isEdit ? 'atualizar' : 'cadastrar'} usuário`, true);
}

async function editUser(user){
  document.getElementById("user-id").value = user.id;
  document.getElementById("user-name").value = user.name;
  document.getElementById("user-registration").value = user.registration;
  document.getElementById("user-salt").value = user.salt || '';
  document.getElementById("user-password").value = user.password || '';
  showUserModal(true);
}

async function deleteUser(id){
  showModal('Confirmar Exclusão', `
    <p>Tem certeza que deseja excluir este usuário?</p>
    <div class="action-buttons">
      <button onclick="confirmDeleteUser('${id}')" class="btn-delete">Excluir</button>
      <button onclick="closeModal(this)" class="btn-edit">Cancelar</button>
    </div>
  `);
}

async function confirmDeleteUser(id) {
  try {
    await fetchJSON(`/users/${id}`, { method: "DELETE" });
    showMessage("Usuário excluído com sucesso!");
    closeModal();
    loadUsers();
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    showError("Erro ao excluir usuário");
  }
}

async function toggleUserBlock(id, name, currentStatus) {
  const action = currentStatus ? 'desbloquear' : 'bloquear';
  showConfirmationModal(
    `Confirmar ${action}`,
    `Deseja ${action} o usuário ${name}?`,
    async () => {
      try {
        const response = await fetchJSON(`/users/${id}/toggle_block`, { 
          method: 'POST' 
        });
        showMessage(response.message);
        loadUsers();
      } catch (error) {
        showError(`Erro ao ${action} usuário`);
      }
    }
  );
}

// --- Biometria ---
function showBiometryForm() {
    // Get the current user ID from the edit form
    const userId = document.getElementById("user-id").value;
    if (!userId) {
        showError("Selecione um usuário primeiro!");
        return;
    }

    closeUserModal();
    
    showModal('Cadastro de Biometria', `
        <div class="form-group">
            <p>Cadastrar biometria para o usuário selecionado?</p>
            <div class="action-buttons">
                <button onclick="registerBiometry('${userId}')" class="btn-bio">Iniciar Cadastro</button>
                <button onclick="closeModal(this)" class="btn-delete">Cancelar</button>
            </div>
        </div>
    `);
}

async function registerBiometry(userId) {
    if(terminalStatus.length === 0){
        showError("Nenhum terminal conectado!");
        return;
    }

    try {
        // Updated to match server endpoint: /biometry/:userId
        const resp = await fetchJSON(`/biometry/${userId}`, { method:"POST" });
        if(resp.success) {
            const terminalInfo = resp.terminal ? ` no terminal ${resp.terminal}` : '';
            showMessage(`Cadastro realizado com sucesso${terminalInfo}!`);
            closeModal(document.querySelector('.modal button')); // Close the current modal
        } else {
            showError("Erro ao iniciar cadastro de biometria");
        }
    } catch (error) {
        console.error('Erro no cadastro de biometria:', error);
        if (error.message.includes("404")) {
            showError("Usuário não encontrado ou sem ID no equipamento. Tente atualizar os IDs primeiro.");
        } else {
            showError("Erro ao iniciar cadastro de biometria. Verifique se o terminal está conectado.");
        }
    }
}

// --- Configurações ---
async function getIDs(){
  const resp = await fetchJSON("/get_ids", { method:"POST" });
  if(resp.success) {
    const terminalInfo = resp.terminal ? ` do terminal ${resp.terminal}` : '';
    showMessage(`IDs atualizados${terminalInfo}!`);
  }
  loadUsers();
}

async function deleteAllEquipment(){
  const resp = await fetchJSON("/users/delete_all", { method:"POST" });
  if(resp.success) {
    const terminalInfo = resp.terminalsProcessed ? ` de ${resp.terminalsProcessed} terminais` : '';
    showMessage(`Todos os usuários deletados${terminalInfo}!`);
  }
  loadUsers();
}

async function clearDB(){
  const resp = await fetchJSON("/users/clear_db", { method:"POST" });
  if(resp.success) showMessage("Todos os usuários do banco apagados!");
  loadUsers();
}

async function sendAllUsers() {
  try {
    showMessage("Iniciando envio de todos os cadastros...", false);
    
    // Primeiro, obtém todos os usuários do banco
    const users = await fetchJSON("/users");
    
    if (users.length === 0) {
      showMessage("Não há usuários cadastrados no banco de dados!", true);
      return;
    }

    // Mostra modal de confirmação
    showConfirmationModal(
      "Enviar Cadastros",
      `Deseja enviar ${users.length} cadastros para o terminal selecionado?`,
      async () => {
        try {
          const resp = await fetchJSON("/users/send_all", { 
            method: "POST"
          });
          
          if (resp.success) {
            showMessage(`${resp.totalProcessed} cadastros enviados com sucesso para ${resp.totalTerminals} terminais!`, false);
          } else {
            throw new Error(resp.error || "Erro ao enviar cadastros");
          }
        } catch (error) {
          showError(`Falha ao enviar cadastros: ${error.message}`);
        }
      }
    );
  } catch (error) {
    showError(`Erro ao preparar envio: ${error.message}`);
  }
}

// --- Modal Functions ---
function showConfirmationModal(title, message, onConfirm) {
    const content = `
        <p>${message}</p>
        <div style="text-align: right; margin-top: 20px;">
            <button onclick="closeModal()" class="btn">Cancelar</button>
            <button onclick="handleConfirm()" class="btn-delete" style="margin-left: 10px;">Confirmar</button>
        </div>
    `;
    showModal(title, content);
    window.handleConfirm = () => {
        closeModal();
        onConfirm();
        delete window.handleConfirm;
    };
}

// --- Configuration Functions ---
function showRebootConfirmation() {
    if (terminalStatus.length === 0) {
        showError('Nenhum terminal conectado');
        return;
    }
    showConfirmationModal(
        'Confirmar Reinicialização',
        'Tem certeza que deseja reiniciar o terminal? Isso irá interromper todas as operações em andamento.',
        async () => {
            try {
                const result = await fetchJSON(`/terminal/reboot`, {
                    method: 'POST'
                });
                showMessage(`Comando de reinicialização enviado para ${result.terminalsProcessed} terminais`);
                document.querySelector('#modal').classList.remove('show');
            } catch (error) {
                showError('Falha ao reiniciar os terminais');
            }
        }
    );
}

function showFactoryResetConfirmation() {
    if (terminalStatus.length === 0) {
        showError('Nenhum terminal conectado');
        return;
    }
    showConfirmationModal(
        'Confirmar Reset de Fábrica',
        'ATENÇÃO: Essa operação irá apagar todas as configurações e dados do terminal, restaurando-o às configurações originais de fábrica. Essa ação não pode ser desfeita.',
        async () => {
            try {
                const result = await fetchJSON(`/terminal/factory-reset`, {
                    method: 'POST'
                });
                showMessage(`Comando de reset de fábrica enviado para ${result.terminalsProcessed} terminais`);
                document.querySelector('#modal').classList.remove('show');
            } catch (error) {
                showError('Falha ao restaurar os terminais');
            }
        }
    );
}

function showMasterPasswordModal() {
    if (terminalStatus.length === 0) {
        showError('Nenhum terminal conectado');
        return;
    }
    const content = `
        <form id="master-password-form">
            <div class="form-group">
                <label for="masterPassword">Nova Senha Mestra:</label>
                <input type="password" id="masterPassword" required>
            </div>
            <div class="form-group">
                <label for="confirmPassword">Confirme a Senha:</label>
                <input type="password" id="confirmPassword" required>
            </div>
            <div style="text-align: right; margin-top: 20px;">
                <button type="button" onclick="closeModal()" class="btn">Cancelar</button>
                <button type="submit" class="btn-edit">Salvar</button>
            </div>
        </form>
    `;
    showModal('Alterar Senha Mestra', content);
    
    // Adiciona o handler de submit após o modal estar no DOM
    document.getElementById('master-password-form').onsubmit = handleMasterPasswordSubmit;
}

async function handleMasterPasswordSubmit(event) {
    event.preventDefault();
    const password = document.getElementById('masterPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (password !== confirmPassword) {
        showError('As senhas não coincidem');
        return;
    }

    try {
        const result = await fetchJSON(`/terminal/master-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });
        document.querySelector('#modal').classList.remove('show');
        showMessage(`Senha mestra atualizada em ${result.terminalsProcessed} terminais`);
    } catch (error) {
        showError('Falha ao atualizar a senha mestra');
    }
}

function showNetworkConfigModal() {
    if (terminalStatus.length === 0) {
        showError('Nenhum terminal conectado');
        return;
    }
    const content = `
        <form id="network-form" class="network-form">
            <div class="form-group">
                <label for="ip">Endereço IP:</label>
                <input type="text" id="ip" pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$" required>
            </div>
            <div class="form-group">
                <label for="gateway">Gateway:</label>
                <input type="text" id="gateway" pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$" required>
            </div>
            <div class="form-group">
                <label for="mask">Máscara de Rede:</label>
                <input type="text" id="mask" pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$" required>
            </div>
            <div style="text-align: right; grid-column: 1 / -1; margin-top: 20px;">
                <button type="button" onclick="closeModal()" class="btn">Cancelar</button>
                <button type="submit" class="btn-edit">Salvar</button>
            </div>
        </form>
    `;
    showModal('Configurar Rede', content);
    
    // Adiciona o handler de submit após o modal estar no DOM
    document.getElementById('network-form').onsubmit = handleNetworkConfigSubmit;
}

async function handleNetworkConfigSubmit(event) {
    event.preventDefault();
    const config = {
        ip: document.getElementById('ip').value,
        gateway: document.getElementById('gateway').value,
        mask: document.getElementById('mask').value
    };

    try {
        const result = await fetchJSON(`/terminal/network`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        document.querySelector('#modal').classList.remove('show');
        showMessage(`Configurações de rede atualizadas em ${result.terminalsProcessed} terminais`);
    } catch (error) {
        showError('Falha ao atualizar as configurações de rede');
    }
}

function openSecbox() {
    if (terminalStatus.length === 0) {
        showError('Nenhum terminal conectado');
        return;
    }
    showConfirmationModal(
        'Confirmar Abertura do Cofre',
        'Tem certeza que deseja abrir o cofre do terminal?',
        async () => {
            try {
                const result = await fetchJSON(`/terminal/open-secbox`, {
                    method: 'POST'
                });
                showMessage(`Comando de abertura enviado para ${result.terminalsProcessed} cofres`);
                document.querySelector('#modal').classList.remove('show');
            } catch (error) {
                showError('Falha ao enviar comando para os cofres');
            }
        }
    );
}

// --- Monitor Functions ---
let cachedUsers = []; // Cache para armazenar os usuários

async function loadMonitoringCache() {
    try {
        cachedUsers = await fetchJSON('/users');
    } catch (error) {
        console.error('Erro ao carregar cache de usuários:', error);
    }
}

function getUserName(userId) {
    const user = cachedUsers.find(u => u.id === userId);
    return user ? user.name : 'Usuário bloqueado ou não cadastrado no banco de dados!';
}

function showMonitorConfigModal() {
    if (terminalStatus.length === 0) {
        showError('Nenhum terminal conectado');
        return;
    }
    const content = `
        <form id="monitor-form">
            <div class="form-group">
                <label for="monitorHostname">Hostname:</label>
                <input type="text" id="monitorHostname" value="192.168.100.210" required>
            </div>
            <div class="form-group">
                <label for="monitorPort">Porta:</label>
                <input type="number" id="monitorPort" value="3000" required min="1" max="65535">
            </div>
            <div style="text-align: right; margin-top: 20px;">
                <button type="button" onclick="closeModal()" class="btn">Cancelar</button>
                <button type="submit" class="btn-edit">Salvar</button>
            </div>
        </form>
    `;
    showModal('Configurar Monitor', content);
    
    // Adiciona o handler de submit após o modal estar no DOM
    document.getElementById('monitor-form').onsubmit = handleMonitorConfigSubmit;
}

async function handleMonitorConfigSubmit(event) {
    event.preventDefault();
    const config = {
        hostname: document.getElementById('monitorHostname').value,
        port: document.getElementById('monitorPort').value
    };

    try {
        const result = await fetchJSON(`/terminal/configure-monitor`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        document.querySelector('#modal').classList.remove('show');
        showMessage(`Monitor configurado em ${result.terminalsProcessed} terminais`);
    } catch (error) {
        showError('Falha ao configurar o monitor');
    }
}

// Configura SSE para receber eventos do servidor
const evtSource = new EventSource('/events');
evtSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    if (data.type === 'access') {
        const access = data.data;
        const eventType = access.details.event;
        let statusMessage;
        let statusClass;

        // Interpretar o tipo de evento
        if (eventType === "7") {
            statusMessage = "Acesso Liberado";
            statusClass = "access-authorized";
        } else if (eventType === "6") {
            statusMessage = "Acesso Negado";
            statusClass = "access-denied";
        } else {
            statusMessage = "Monitoramento De Acesso";
            statusClass = "access-denied";
        }
        
        // Create access event element
        const accessEvent = document.createElement('div');
        accessEvent.className = `access-event ${statusClass}`;
        accessEvent.innerHTML = `
            <strong>${statusMessage}</strong><br>
            Usuário: ${access.user_name}<br>
            Portal: ${access.portal_id}<br>
            Hora: ${new Date(access.time * 1000).toLocaleString()}
        `;
        
        // Add to access logs
        const accessLogs = document.getElementById('access-logs');
        accessLogs.insertBefore(accessEvent, accessLogs.firstChild);
        
        // Limit number of shown events
        if (accessLogs.children.length > 50) {
            accessLogs.removeChild(accessLogs.lastChild);
        }
    }
};

async function loadAccessLogs(date) {
    try {
        const logs = await fetchJSON(`/access-logs?date=${date}`);
        const accessLogs = document.getElementById('access-logs');
        accessLogs.innerHTML = '';
        
        logs.forEach(log => {
            const accessEvent = document.createElement('div');
            accessEvent.className = 'access-event';
            accessEvent.innerHTML = `
                <strong>Monitoramento De Acesso</strong><br>
                Usuário: ${log.user_name}<br>
                Portal: ${log.portal_id}<br>
                Hora: ${new Date(log.timestamp * 1000).toLocaleString()}
            `;
            accessLogs.appendChild(accessEvent);
        });
    } catch (error) {
        showError('Erro ao carregar logs de acesso');
    }
}

// Função para formatar data como YYYY-MM-DD
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

// --- Dashboard Functions ---
async function updateDashboard() {
    try {
        // Contagem de usuários
        const users = await fetchJSON('/users');
        document.getElementById('total-users').textContent = users.length;

        // Contagem e status dos terminais
        const terminals = await fetchJSON('/terminals');
        document.getElementById('total-terminals').textContent = terminals.length;
        
        let onlineCount = 0;
        for (const terminal of terminals) {
            if (await checkTerminalStatus(terminal)) {
                onlineCount++;
            }
        }
        document.getElementById('online-terminals').textContent = onlineCount;

        // Acessos do dia
        const today = formatDate(new Date());
        const logs = await fetchJSON(`/access-logs?date=${today}`);
        
        document.getElementById('today-access').textContent = logs.length;
        
        const authorized = logs.filter(log => log.event_type === 'authorized').length;
        const denied = logs.filter(log => log.event_type === 'denied').length;
        
        document.getElementById('authorized-access').textContent = authorized;
        document.getElementById('denied-access').textContent = denied;
    } catch (error) {
        console.error('Erro ao atualizar dashboard:', error);
    }
}

// Função para atualizar o status dos terminais periodicamente
function startStatusCheck() {
    // Verifica imediatamente
    loadTerminals();
    updateDashboard();
    
    // Configura verificação a cada 5 segundos
    setInterval(() => {
        loadTerminals();
        updateDashboard();
    }, 5000);
}

// Função para mostrar uma seção
function showSection(sectionId) {
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        section.style.display = section.id === sectionId ? 'block' : 'none';
    });

    // Se estiver mostrando o dashboard, atualiza imediatamente
    if (sectionId === 'dashboard-section') {
        updateDashboard();
    }
}

// --- Inicialização ---
startStatusCheck();
loadUsers();
loadMonitoringCache();
loadAccessLogs(formatDate(new Date()));
