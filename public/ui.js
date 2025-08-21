// UI related functions
function toggleSidebar() {
    const body = document.body;
    
    // Toggle da classe sidebar-collapsed
    body.classList.toggle('sidebar-collapsed');
    
    // Fecha qualquer submenu aberto quando retrair o menu
    if (body.classList.contains('sidebar-collapsed')) {
        const activeSubmenus = document.querySelectorAll('.submenu.active');
        activeSubmenus.forEach(submenu => submenu.classList.remove('active'));
    }
}

function toggleSubmenu(submenuId) {
    const submenu = document.getElementById(submenuId);
    const allSubmenus = document.querySelectorAll('.submenu');
    
    allSubmenus.forEach(menu => {
        if (menu.id !== submenuId) {
            menu.classList.remove('active');
        }
    });
    
    submenu.classList.toggle('active');
}

function showSection(sectionId) {
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    document.getElementById(sectionId).style.display = 'block';

    // Se estiver mostrando o dashboard, atualiza imediatamente
    if (sectionId === 'dashboard-section' && typeof updateDashboard === 'function') {
        updateDashboard();
    }
}

function showMessage(message, type = 'success') {
    const messageElement = document.getElementById('message');
    messageElement.textContent = message;
    messageElement.className = `message-${type} show`;
    
    setTimeout(() => {
        messageElement.classList.remove('show');
    }, 3000);
}

function showModal(title, content) {
    const modal = document.getElementById('modal');
    const modalTitle = modal.querySelector('.modal-title');
    const modalBody = modal.querySelector('.modal-body');
    
    modalTitle.textContent = title;
    modalBody.innerHTML = content;
    modal.classList.add('show');
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('show');
}

// Initialize the UI
document.addEventListener('DOMContentLoaded', () => {
    // Show dashboard section by default
    showSection('dashboard-section');
});
