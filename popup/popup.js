// Global Error Handler for debugging
window.onerror = function (message, source, lineno, colno, error) {
    alert(`Error: ${message}\nSource: ${source}:${lineno}`);
    console.error('Global Error:', error);
};

console.log('Popup script loaded');

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    const scanBtn = document.getElementById('scan-btn');
    const stopBtn = document.getElementById('stop-btn');
    const granularitySelect = document.getElementById('granularity-select');
    const dashboardView = document.getElementById('dashboard-view');
    const previewView = document.getElementById('preview-view');
    const settingsView = document.getElementById('settings-view');
    const treePreview = document.getElementById('tree-preview');
    const backBtn = document.getElementById('back-btn');
    const applyBtn = document.getElementById('apply-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveKeysBtn = document.getElementById('save-keys-btn');
    const firecrawlInput = document.getElementById('firecrawl-key');
    const llmInput = document.getElementById('llm-key');
    const premiumModal = document.getElementById('premium-modal');
    const closeModal = document.querySelector('.close-modal');
    const upgradeBtn = document.getElementById('upgrade-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressDetail = document.getElementById('progress-detail');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');
    const totalBookmarkCount = document.getElementById('total-bookmark-count');

    let currentProposedStructure = null;
    let currentMetadata = null;
    let savingInterval = null;

    const analysisModeSelect = document.getElementById('analysis-mode');

    // Load saved keys and settings
    chrome.storage.local.get(['firecrawlKey', 'llmKey', 'analysisMode', 'isPremium'], (result) => {
        if (result.firecrawlKey) firecrawlInput.value = result.firecrawlKey;
        if (result.llmKey) llmInput.value = result.llmKey;
        if (result.analysisMode) analysisModeSelect.value = result.analysisMode;

        if (result.isPremium) {
            document.getElementById('status-badge').textContent = 'Premium';
            document.getElementById('status-badge').style.background = '#e9d5ff';
            document.getElementById('status-badge').style.color = '#7e22ce';
            document.body.classList.add('is-premium');

            // Update dropdown text
            const specificOption = document.querySelector('#granularity-select option[value="specific"]');
            if (specificOption) specificOption.textContent = 'Specific';
        }
    });

    // Settings Navigation
    settingsBtn.addEventListener('click', () => {
        switchView('settings');
    });

    const openWindowBtn = document.getElementById('open-window-btn');
    if (openWindowBtn) {
        openWindowBtn.addEventListener('click', () => {
            chrome.windows.create({
                url: chrome.runtime.getURL("popup/popup.html"),
                type: "popup",
                width: 800,
                height: 600
            });
            window.close();
        });
    }

    closeSettingsBtn.addEventListener('click', () => {
        switchView('dashboard');
    });

    saveKeysBtn.addEventListener('click', () => {
        const firecrawlKey = firecrawlInput.value.trim();
        const llmKey = llmInput.value.trim();
        const analysisMode = analysisModeSelect.value;

        chrome.storage.local.set({ firecrawlKey, llmKey, analysisMode }, () => {
            alert('Settings saved!');
            switchView('dashboard');
        });
    });

    const granularityCountInput = document.getElementById('granularity-count');

    // Handle Granularity Selection
    // Handle Granularity Selection
    granularitySelect.addEventListener('change', (e) => {
        if (e.target.value === 'specific') {
            // Check Premium Status
            chrome.storage.local.get(['isPremium'], (result) => {
                if (result.isPremium) {
                    granularityCountInput.classList.remove('hidden');
                } else {
                    // Not premium: Show modal and revert
                    premiumModal.classList.remove('hidden');
                    granularitySelect.value = 'medium'; // Revert to default
                    granularityCountInput.classList.add('hidden');
                }
            });
        } else {
            granularityCountInput.classList.add('hidden');
        }
    });

    closeModal.addEventListener('click', () => {
        premiumModal.classList.add('hidden');
    });

    upgradeBtn.addEventListener('click', () => {
        // Simulate upgrade
        chrome.storage.local.set({ isPremium: true }, () => {
            alert('Upgrade simulation: You are now Premium!');
            premiumModal.classList.add('hidden');
            document.getElementById('status-badge').textContent = 'Premium';
            document.getElementById('status-badge').style.background = '#e9d5ff';
            document.getElementById('status-badge').style.color = '#7e22ce';
            document.body.classList.add('is-premium');

            // Update dropdown text
            const specificOption = document.querySelector('#granularity-select option[value="specific"]');
            if (specificOption) specificOption.textContent = 'Specific';

            // If they were trying to select specific, maybe we could auto-select it?
            // For now, let them select it manually.
        });
    });

    // Scan Bookmarks
    scanBtn.addEventListener('click', () => {
        startScan();
    });

    async function startScan() {
        // Check for API Keys first
        const { firecrawlKey, llmKey } = await chrome.storage.local.get(['firecrawlKey', 'llmKey']);

        if (!firecrawlKey || !llmKey) {
            showToast('Please enter your OpenAI and Firecrawl API keys.', 'error');
            switchView('settings');
            return;
        }

        // Reset UI
        currentProposedStructure = null;
        renderTree([], treePreview);

        // Show progress, hide scan, show stop
        progressContainer.classList.remove('hidden');
        scanBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        stopBtn.disabled = false; // Ensure stop button is enabled

        try {
            // Send message to background script
            const mode = document.getElementById('analysis-mode').value;
            const granularityMode = granularitySelect.value;
            let targetCount = 10; // Default Medium

            if (granularityMode === 'broad') targetCount = 5;
            else if (granularityMode === 'medium') targetCount = 10;
            else if (granularityMode === 'specific') {
                targetCount = parseInt(granularityCountInput.value, 10) || 15;
                if (targetCount < 1) targetCount = 1;
                if (targetCount > 50) targetCount = 50;
            }

            const response = await chrome.runtime.sendMessage({
                action: 'analyze_bookmarks',
                settings: {
                    granularity: {
                        mode: granularityMode,
                        count: targetCount
                    },
                    analysisMode: mode
                }
            });

            // This block might not be reached if background script handles completion via messages
            if (response.status === 'success') {
                console.log('Analysis initiated successfully');
                // Do NOT switch view here. Wait for 'status_update' -> 'complete' message.
            } else if (response.status === 'error') {
                alert('Error analyzing bookmarks: ' + response.message);
            }
        } catch (error) {
            console.error(error);
            // Fallback for testing without extension context
            console.log('Extension context not found, using mock data');
            const mockData = getMockData();
            renderTree(mockData, treePreview);
            switchView('preview');
        } finally {
            // setLoading(false); // This will be handled by processing_complete/stopped messages
        }
    }

    stopBtn.addEventListener('click', async () => {
        // Optimistic UI update
        progressText.textContent = "Stopping...";
        stopBtn.disabled = true;

        try {
            await chrome.runtime.sendMessage({ action: 'stop_analysis' });

            // Failsafe: If background doesn't send 'stopped' status within 2s, force reset
            setTimeout(() => {
                if (!stopBtn.classList.contains('hidden')) {
                    console.warn('Stop timeout reached, forcing UI reset');
                    // Reset UI manually
                    scanBtn.classList.remove('hidden');
                    scanBtn.disabled = false;
                    const btnText = scanBtn.querySelector('.btn-text');
                    const loader = scanBtn.querySelector('.loader');
                    btnText.classList.remove('hidden');
                    loader.classList.add('hidden');

                    progressContainer.classList.add('hidden');
                    stopBtn.classList.add('hidden');
                    progressText.textContent = "Initializing...";
                    progressFill.style.width = '0%';
                }
            }, 5000);

        } catch (e) {
            console.error('Failed to stop:', e);
            alert('Failed to stop analysis');
            stopBtn.disabled = false;
        }
    });

    backBtn.addEventListener('click', () => {
        // Reset UI to initial state
        scanBtn.classList.remove('hidden');
        scanBtn.disabled = false;
        const btnText = scanBtn.querySelector('.btn-text');
        const loader = scanBtn.querySelector('.loader');
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');

        progressContainer.classList.add('hidden');
        stopBtn.classList.add('hidden');
        progressText.textContent = 'Initializing...';
        progressFill.style.width = '0%';
        progressDetail.textContent = '';
        progressDetail.classList.add('hidden');

        // Clear any polling intervals
        if (savingInterval) {
            clearInterval(savingInterval);
            savingInterval = null;
        }

        // Clear processing state so we don't return to progress screen
        chrome.storage.local.remove(['processingState']);

        switchView('dashboard');
    });

    applyBtn.addEventListener('click', async () => {
        if (!currentProposedStructure) return;

        applyBtn.textContent = 'Applying...';
        applyBtn.disabled = true;

        try {
            await chrome.runtime.sendMessage({
                action: 'apply_structure',
                structure: currentProposedStructure
            });
            alert('Bookmarks organized successfully!');
            switchView('dashboard');
        } catch (error) {
            console.error(error);
            alert('Simulated Apply: Success!');
            switchView('dashboard');
        } finally {
            applyBtn.textContent = 'Apply Changes';
            applyBtn.disabled = false;
        }
    });

    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            const treeContainer = document.getElementById('tree-preview');
            treeContainer.querySelectorAll('.tree-children').forEach(el => el.classList.remove('hidden'));
            treeContainer.querySelectorAll('.tree-toggle').forEach(el => el.classList.remove('collapsed'));
        });
    }

    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            const treeContainer = document.getElementById('tree-preview');
            treeContainer.querySelectorAll('.tree-children').forEach(el => el.classList.add('hidden'));
            treeContainer.querySelectorAll('.tree-toggle').forEach(el => el.classList.add('collapsed'));
        });
    }

    function switchView(viewName) {
        dashboardView.classList.add('hidden');
        previewView.classList.add('hidden');
        settingsView.classList.add('hidden');

        if (viewName === 'preview') {
            previewView.classList.remove('hidden');
        } else if (viewName === 'settings') {
            settingsView.classList.remove('hidden');
            loadBackups(); // Load backups when entering settings
        } else {
            dashboardView.classList.remove('hidden');
        }

        // Save state
        chrome.storage.local.set({ currentView: viewName });
    }

    function loadBackups() {
        const list = document.getElementById('backup-list');
        list.innerHTML = '<p class="help-text">Loading...</p>';

        chrome.storage.local.get(['backups'], (result) => {
            const backups = result.backups || [];
            list.innerHTML = '';

            if (backups.length === 0) {
                list.innerHTML = '<p class="help-text">No backups found.</p>';
                return;
            }

            backups.forEach(backup => {
                const item = document.createElement('div');
                item.className = 'backup-item';

                const date = new Date(backup.timestamp).toLocaleString();

                item.innerHTML = `
                    <div class="backup-info">
                        <span class="backup-date">${date}</span>
                        <span class="backup-count">${backup.count} bookmarks</span>
                    </div>
                    <button class="restore-btn" data-id="${backup.id}">Restore</button>
                `;

                item.querySelector('.restore-btn').addEventListener('click', () => {
                    if (confirm(`Are you sure you want to restore the backup from ${date}?\n\n⚠️ THIS WILL REPLACE ALL CURRENT BOOKMARKS!`)) {
                        if (confirm("Double check: This action cannot be undone. Proceed?")) {
                            restoreBackup(backup.id);
                        }
                    }
                });

                list.appendChild(item);
            });
        });
    }

    async function restoreBackup(backupId) {
        // Show progress UI immediately
        progressContainer.classList.remove('hidden');
        scanBtn.classList.add('hidden');
        stopBtn.classList.add('hidden'); // No stop for restore
        progressText.textContent = "Restoring backup...";
        switchView('dashboard'); // Go back to dashboard to show progress

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'restore_backup',
                backupId: backupId
            });

            if (response.status === 'success') {
                alert('Backup restored successfully!');
                setLoading(false);
            } else {
                alert('Error restoring backup: ' + response.message);
                setLoading(false);
            }
        } catch (error) {
            console.error(error);
            alert('Error sending restore command.');
            setLoading(false);
        }
    }

    // Check for existing process or saved state on load
    // Optimization: Don't fetch 'analysisResult' (potentially large) unless we need it
    chrome.storage.local.get(['processingState', 'currentView'], (result) => {
        // 1. If processing, show progress (highest priority)
        if (result.processingState && result.processingState.status === 'processing') {
            updateProgressUI(result.processingState);
            return;
        }

        // 2. If we were in preview mode, we need to fetch the data
        if (result.currentView === 'preview') {
            // Now fetch the heavy data
            chrome.storage.local.get(['analysisResult'], (data) => {
                if (data.analysisResult) {
                    // Handle new metadata structure
                    if (data.analysisResult.structure) {
                        currentProposedStructure = data.analysisResult.structure;
                        currentMetadata = data.analysisResult.metadata || {};
                    } else {
                        // Fallback for old format
                        currentProposedStructure = data.analysisResult;
                        currentMetadata = {};
                    }
                    renderTree(currentProposedStructure, treePreview);
                    updateDuplicateStats();
                    switchView('preview');
                } else {
                    // Fallback if data missing
                    switchView('dashboard');
                }
            });
        } else if (result.currentView === 'settings') {
            switchView('settings');
        } else {
            // Default to dashboard - instant load
            switchView('dashboard');
        }
    });

    // Listen for live updates
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'status_update') {
            updateProgressUI(request.state);
        } else if (request.action === 'quota_exceeded_warning') {
            showToast(request.message, 'warning', 'Restart in Metadata Mode', () => {
                // Update UI to reflect change
                document.getElementById('analysis-mode').value = 'metadata';
                showToast('Restarting in Metadata Mode...', 'success');

                // Restart scan (this will abort the previous one automatically in background)
                startScan();
            });
        }
    });

    function updateProgressUI(state) {
        if (state.status === 'processing') {
            setLoading(true);
            progressText.textContent = state.message || 'Processing...';

            // Update Progress Bar
            // Update Progress Bar
            if (state.progress) {
                if (state.progress.total > 0) {
                    const percent = Math.round((state.progress.current / state.progress.total) * 100);
                    progressFill.style.width = `${percent}%`;
                    progressDetail.textContent = `${state.progress.current} / ${state.progress.total}`;
                    progressDetail.classList.remove('hidden');

                    // If 100% but still processing (e.g. LLM step), show indeterminate animation
                    if (percent >= 100 && state.status === 'processing') {
                        progressFill.classList.add('indeterminate');
                    } else {
                        progressFill.classList.remove('indeterminate');
                    }
                } else {
                    // Indeterminate state (total is 0)
                    progressFill.style.width = '100%';
                    progressFill.classList.add('indeterminate');
                    progressDetail.classList.add('hidden');
                }
            } else if (state.status === 'error') {
                setLoading(false);
                alert('Error: ' + state.message);
            } else if (state.status === 'stopped') {
                // Reset UI completely
                scanBtn.classList.remove('hidden');
                scanBtn.disabled = false;
                const btnText = scanBtn.querySelector('.btn-text');
                const loader = scanBtn.querySelector('.loader');
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');

                progressContainer.classList.add('hidden');
                stopBtn.classList.add('hidden');
                progressText.textContent = "Initializing...";
                progressFill.style.width = '0%';

            } else if (state.status === 'complete') {
                setLoading(false);

                // 1. Check if structure was passed directly (fast path)
                if (state.structure) {
                    console.log('Structure received directly in message');
                    // Handle new metadata structure
                    if (state.structure.structure) {
                        currentProposedStructure = state.structure.structure;
                        currentMetadata = state.structure.metadata || {};
                    } else {
                        currentProposedStructure = state.structure;
                        currentMetadata = {};
                    }
                    renderTree(currentProposedStructure, treePreview);
                    updateDuplicateStats();
                    switchView('preview');
                    return;
                }

                // 2. Fallback to storage (slow path / large data)
                console.log('Structure not in message, fetching from storage...');
                chrome.storage.local.get(['analysisResult'], (result) => {
                    if (result.analysisResult) {
                        // Handle new metadata structure
                        if (result.analysisResult.structure) {
                            currentProposedStructure = result.analysisResult.structure;
                            currentMetadata = result.analysisResult.metadata || {};
                        } else {
                            currentProposedStructure = result.analysisResult;
                            currentMetadata = {};
                        }
                        renderTree(currentProposedStructure, treePreview);
                        updateDuplicateStats();
                        switchView('preview');
                    } else {
                        alert('Analysis complete, but no result found in storage.');
                    }
                });
            }
        }

        // Polling for "Saving results..." phase
        if (state.message === 'Saving results...' && !savingInterval) {
            console.log('Starting polling for analysis result...');
            savingInterval = setInterval(() => {
                chrome.storage.local.get(['analysisResult'], (result) => {
                    if (result.analysisResult) {
                        console.log('Polling found result!');
                        clearInterval(savingInterval);
                        savingInterval = null;

                        // Mark processing as complete in storage to prevent stuck state
                        chrome.storage.local.set({
                            processingState: { status: 'complete', message: 'Analysis complete!' }
                        });

                        setLoading(false);
                        // Handle new metadata structure
                        if (result.analysisResult.structure) {
                            currentProposedStructure = result.analysisResult.structure;
                            currentMetadata = result.analysisResult.metadata || {};
                        } else {
                            currentProposedStructure = result.analysisResult;
                            currentMetadata = {};
                        }
                        renderTree(currentProposedStructure, treePreview);
                        updateDuplicateStats();
                        switchView('preview');
                    }
                });
            }, 1000); // Check every second
        } else if (state.status === 'complete' || state.status === 'error' || state.status === 'stopped') {
            // Stop polling if we reach a terminal state
            if (savingInterval) {
                clearInterval(savingInterval);
                savingInterval = null;
            }
        }

        function setLoading(isLoading) {
            const btnText = scanBtn.querySelector('.btn-text');
            const loader = scanBtn.querySelector('.loader');

            if (isLoading) {
                scanBtn.classList.add('hidden'); // Hide completely
                // scanBtn.disabled = true; // Not needed if hidden

                progressContainer.classList.remove('hidden');
                stopBtn.classList.remove('hidden');
            } else {
                scanBtn.classList.remove('hidden'); // Show again
                scanBtn.disabled = false;
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');

                // Don't hide progress container immediately on success/error so user can see result
                // But hide stop button
                stopBtn.classList.add('hidden');
            }
        }
    }

    // --- Drag and Drop Logic ---

    function assignUniqueIds(nodes) {
        if (!nodes) return;
        nodes.forEach(node => {
            if (!node.id) {
                node.id = 'node_' + Math.random().toString(36).substr(2, 9);
            }
            if (node.children) {
                assignUniqueIds(node.children);
            }
        });
    }

    let draggedNodeId = null;

    function handleDragStart(e, node) {
        draggedNodeId = node.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.id);
        setTimeout(() => {
            e.target.classList.add('dragging');
        }, 0);
    }

    function handleDragEnd(e) {
        draggedNodeId = null;
        e.target.classList.remove('dragging');
        document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-inside').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
        });
    }

    function handleDragOver(e, targetNode, targetElement) {
        e.preventDefault();
        if (!draggedNodeId || targetNode.id === draggedNodeId) return;

        targetElement.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');

        const rect = targetElement.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const height = rect.height;

        const isFolder = !!targetNode.children;

        if (isFolder) {
            if (offsetY < height * 0.25) {
                targetElement.classList.add('drag-over-top');
            } else if (offsetY > height * 0.75) {
                targetElement.classList.add('drag-over-bottom');
            } else {
                targetElement.classList.add('drag-over-inside');
            }
        } else {
            if (offsetY < height * 0.5) {
                targetElement.classList.add('drag-over-top');
            } else {
                targetElement.classList.add('drag-over-bottom');
            }
        }
    }

    function handleDragLeave(e, targetElement) {
        targetElement.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
    }

    function handleDrop(e, targetNode, targetElement) {
        e.preventDefault();
        e.stopPropagation();

        const droppedNodeId = draggedNodeId;
        if (!droppedNodeId || droppedNodeId === targetNode.id) return;

        let position = 'inside';
        if (targetElement.classList.contains('drag-over-top')) position = 'before';
        else if (targetElement.classList.contains('drag-over-bottom')) position = 'after';
        else if (targetElement.classList.contains('drag-over-inside')) position = 'inside';
        else return;

        moveNode(droppedNodeId, targetNode.id, position);
        renderTree(currentProposedStructure, treePreview);
    }

    function moveNode(nodeId, targetId, position) {
        let nodeToMove = null;
        let oldParent = null;

        const findNode = (nodes, parent) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === nodeId) {
                    nodeToMove = nodes[i];
                    oldParent = parent;
                    return true;
                }
                if (nodes[i].children) {
                    if (findNode(nodes[i].children, nodes[i])) return true;
                }
            }
            return false;
        };

        const rootList = currentProposedStructure;
        for (let i = 0; i < rootList.length; i++) {
            if (rootList[i].id === nodeId) {
                nodeToMove = rootList[i];
                oldParent = null;
                break;
            }
            if (rootList[i].children) {
                if (findNode(rootList[i].children, rootList[i])) break;
            }
        }

        if (!nodeToMove) return;

        if (oldParent) {
            oldParent.children = oldParent.children.filter(n => n.id !== nodeId);
        } else {
            const index = currentProposedStructure.findIndex(n => n.id === nodeId);
            if (index > -1) currentProposedStructure.splice(index, 1);
        }

        let targetParent = null;
        let targetObj = null;

        const findTarget = (nodes, parent) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === targetId) {
                    targetObj = nodes[i];
                    targetParent = parent;
                    return true;
                }
                if (nodes[i].children) {
                    if (findTarget(nodes[i].children, nodes[i])) return true;
                }
            }
            return false;
        };

        for (let i = 0; i < rootList.length; i++) {
            if (rootList[i].id === targetId) {
                targetObj = rootList[i];
                targetParent = null;
                break;
            }
            if (rootList[i].children) {
                if (findTarget(rootList[i].children, rootList[i])) break;
            }
        }

        if (!targetObj) return;

        if (nodeToMove.children) {
            const isDescendant = (parent, childId) => {
                if (!parent.children) return false;
                for (const child of parent.children) {
                    if (child.id === childId) return true;
                    if (isDescendant(child, childId)) return true;
                }
                return false;
            };
            if (isDescendant(nodeToMove, targetId)) {
                alert("Cannot move a folder into its own subfolder.");
                if (oldParent) oldParent.children.push(nodeToMove);
                else currentProposedStructure.push(nodeToMove);
                return;
            }
        }

        if (position === 'inside') {
            if (!targetObj.children) targetObj.children = [];
            targetObj.children.push(nodeToMove);
        } else {
            const listToInsert = targetParent ? targetParent.children : currentProposedStructure;
            let newTargetIndex = listToInsert.findIndex(n => n.id === targetId);

            if (position === 'before') {
                listToInsert.splice(newTargetIndex, 0, nodeToMove);
            } else {
                listToInsert.splice(newTargetIndex + 1, 0, nodeToMove);
            }
        }
    }

    function deleteNode(nodeId) {
        const removeRecursive = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === nodeId) {
                    nodes.splice(i, 1);
                    return true;
                }
                if (nodes[i].children) {
                    if (removeRecursive(nodes[i].children)) return true;
                }
            }
            return false;
        };

        if (removeRecursive(currentProposedStructure)) {
            renderTree(currentProposedStructure, treePreview);
            updateDuplicateStats();
        }
    }

    function renderTree(treeData, container) {
        if (!treeData) treeData = [];
        assignUniqueIds(treeData);
        container.innerHTML = '';

        // Update Total Count
        const countTotalBookmarks = (nodes) => {
            let count = 0;
            if (!nodes) return 0;
            nodes.forEach(node => {
                if (node.children) {
                    count += countTotalBookmarks(node.children);
                } else {
                    count++;
                }
            });
            return count;
        };

        const total = countTotalBookmarks(treeData);
        const countEl = document.getElementById('total-bookmark-count');
        if (countEl) countEl.textContent = `(${total})`;

        // Helper to create folder node
        const createFolderNode = (node) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'tree-node';

            const header = document.createElement('div');
            header.className = 'tree-folder-header';
            header.draggable = true;
            header.addEventListener('dragstart', (e) => handleDragStart(e, node));
            header.addEventListener('dragend', handleDragEnd);
            header.addEventListener('dragover', (e) => handleDragOver(e, node, header));
            header.addEventListener('dragleave', (e) => handleDragLeave(e, header));
            header.addEventListener('drop', (e) => handleDrop(e, node, header));

            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle';
            // Down Arrow SVG
            toggle.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

            const icon = document.createElement('span');
            icon.style.display = 'flex';
            // Folder SVG
            icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
            icon.style.marginRight = '4px';

            const title = document.createElement('span');
            title.className = 'tree-item-title';
            title.textContent = node.title;
            title.contentEditable = true;
            title.onblur = () => { node.title = title.textContent; }; // Save on blur

            header.appendChild(toggle);
            header.appendChild(icon);
            header.appendChild(title);

            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';

            // Toggle Logic
            header.onclick = (e) => {
                if (e.target === title) return; // Don't toggle if editing title
                toggle.classList.toggle('collapsed');
                childrenContainer.classList.toggle('hidden');
                // Rotate logic is handled by CSS transform on .collapsed, so we don't need to swap SVG content
            };

            wrapper.appendChild(header);
            wrapper.appendChild(childrenContainer);

            // Render children
            if (node.children) {
                node.children.forEach(child => {
                    if (child.children) {
                        childrenContainer.appendChild(createFolderNode(child));
                    } else {
                        childrenContainer.appendChild(createItemNode(child));
                    }
                });
            }

            return wrapper;
        };

        // Helper to create item (bookmark) node
        const createItemNode = (node) => {
            const item = document.createElement('div');
            item.className = 'tree-item';
            item.draggable = true;
            item.addEventListener('dragstart', (e) => handleDragStart(e, node));
            item.addEventListener('dragend', handleDragEnd);
            item.addEventListener('dragover', (e) => handleDragOver(e, node, item));
            item.addEventListener('dragleave', (e) => handleDragLeave(e, item));
            item.addEventListener('drop', (e) => handleDrop(e, node, item));

            // Build Tooltip Content
            let tooltip = `URL: ${node.url}`;
            if (node.tags && node.tags.length > 0) {
                tooltip += `\nTags: ${node.tags.join(', ')}`;
            }
            item.setAttribute('data-tooltip', tooltip);

            // Dead Link Check
            if (node.scrapeStatus === 'dead') {
                item.classList.add('dead-link');
            }

            // Duplicate Check
            if (node.isDuplicate) {
                item.classList.add('duplicate-link');
            }

            const content = document.createElement('div');
            content.className = 'tree-item-content';

            // Action Container (Fixed width for alignment)
            const actionContainer = document.createElement('div');
            actionContainer.className = 'action-container';
            content.appendChild(actionContainer);

            // Smart Rename / Undo Button (Inside Action Container)
            if (node.suggestedTitle && node.suggestedTitle !== node.title && !node.originalTitle) {
                // Case 1: Not yet renamed (Show Sparkles)
                const autoBtn = document.createElement('button');
                autoBtn.className = 'smart-rename-btn';
                autoBtn.title = `Auto-rename to: ${node.suggestedTitle}`;
                autoBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;

                autoBtn.onclick = (e) => {
                    e.stopPropagation();
                    node.originalTitle = node.title;
                    node.title = node.suggestedTitle;
                    const newItem = createItemNode(node);
                    item.replaceWith(newItem);
                    updateUndoAllButton();
                };
                actionContainer.appendChild(autoBtn);
            } else if (node.originalTitle && node.title === node.suggestedTitle) {
                // Case 2: Renamed (Show Undo)
                const undoBtn = document.createElement('button');
                undoBtn.className = 'smart-rename-btn';
                undoBtn.title = "Undo rename";
                undoBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`;

                undoBtn.onclick = (e) => {
                    e.stopPropagation();
                    node.title = node.originalTitle;
                    delete node.originalTitle;
                    const newItem = createItemNode(node);
                    item.replaceWith(newItem);
                    updateUndoAllButton();
                };
                actionContainer.appendChild(undoBtn);
            }

            // Icon
            const icon = document.createElement('span');
            icon.style.display = 'flex'; // Ensure SVG aligns
            if (node.scrapeStatus === 'dead') {
                // Alert Circle SVG (Red)
                icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
                icon.title = "Broken Link";
                icon.className = 'dead-link-indicator';
            } else {
                // Link SVG
                icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
            }
            content.appendChild(icon);

            // Title
            const title = document.createElement('span');
            title.className = 'tree-item-title';
            title.textContent = node.title;
            title.contentEditable = true;
            title.onblur = () => { node.title = title.textContent; };

            content.appendChild(title);

            // Delete Button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-btn small danger delete-btn';
            // Trash SVG
            deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            deleteBtn.title = "Delete Bookmark";
            deleteBtn.style.marginLeft = 'auto';
            deleteBtn.style.opacity = '0'; // Hidden by default
            deleteBtn.style.transition = 'opacity 0.2s';

            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm("Are you sure you want to delete this bookmark?")) {
                    deleteNode(node.id);
                }
            };

            // Show on hover
            item.addEventListener('mouseenter', () => { deleteBtn.style.opacity = '1'; });
            item.addEventListener('mouseleave', () => { deleteBtn.style.opacity = '0'; });

            content.appendChild(deleteBtn);
            item.appendChild(content);
            return item;
        };

        // Root level rendering
        treeData.forEach(node => {
            if (node.children) {
                container.appendChild(createFolderNode(node));
            } else {
                container.appendChild(createItemNode(node));
            }
        });

        updateUndoAllButton();
        updateBrokenStats(treeData);
    }

    // --- New Event Listeners for Preview Actions ---

    const applyAllBtn = document.getElementById('apply-all-titles-btn');
    const undoAllBtn = document.getElementById('undo-all-titles-btn');

    function updateUndoAllButton() {
        if (!undoAllBtn || !currentProposedStructure) return;

        // Check if any node has originalTitle set
        let hasRenames = false;
        const checkRecursive = (nodes) => {
            for (const node of nodes) {
                if (node.originalTitle) {
                    hasRenames = true;
                    return;
                }
                if (node.children) {
                    checkRecursive(node.children);
                    if (hasRenames) return;
                }
            }
        };
        checkRecursive(currentProposedStructure);

        if (hasRenames) {
            undoAllBtn.classList.remove('hidden');
            applyAllBtn.classList.add('hidden'); // Optional: hide Apply if Undo is visible? Or keep both.
            // Let's keep both visible if needed, or toggle. 
            // Better UX: Keep Apply All visible (to apply remaining), show Undo All if any applied.
            applyAllBtn.classList.remove('hidden');
        } else {
            undoAllBtn.classList.add('hidden');
            applyAllBtn.classList.remove('hidden');
        }
    }

    if (applyAllBtn) {
        applyAllBtn.addEventListener('click', () => {
            if (!currentProposedStructure) return;

            let count = 0;
            const applyRecursive = (nodes) => {
                nodes.forEach(node => {
                    if (node.suggestedTitle && node.suggestedTitle !== node.title && !node.originalTitle) {
                        node.originalTitle = node.title;
                        node.title = node.suggestedTitle;
                        count++;
                    }
                    if (node.children) applyRecursive(node.children);
                });
            };

            applyRecursive(currentProposedStructure);
            renderTree(currentProposedStructure, treePreview);
            // alert(`Applied ${count} smart titles!`); // Removed alert for smoother flow
        });
    }

    if (undoAllBtn) {
        undoAllBtn.addEventListener('click', () => {
            if (!currentProposedStructure) return;

            const undoRecursive = (nodes) => {
                nodes.forEach(node => {
                    if (node.originalTitle) {
                        node.title = node.originalTitle;
                        delete node.originalTitle;
                    }
                    if (node.children) undoRecursive(node.children);
                });
            };

            undoRecursive(currentProposedStructure);
            renderTree(currentProposedStructure, treePreview);
        });
    }

    // Recalculate Controls
    const recalcBtn = document.getElementById('recalc-btn');
    const recalcInput = document.getElementById('recalc-cats-input');

    if (recalcBtn && recalcInput) {
        recalcBtn.addEventListener('click', () => {
            const count = parseInt(recalcInput.value, 10);
            if (!count || count < 1) {
                alert("Please enter a valid number of categories (1-50).");
                return;
            }

            if (confirm(`Recalculate structure with ~${count} categories?`)) {
                // Update main settings to match
                granularitySelect.value = 'specific';
                granularityCountInput.value = count;
                granularityCountInput.classList.remove('hidden');

                // Trigger scan
                scanBtn.click();
            }
        });
    }

    // Broken Link Controls
    const brokenControls = document.getElementById('broken-link-controls');
    const brokenCountEl = document.getElementById('broken-count');
    const removeBrokenBtn = document.getElementById('remove-broken-btn');

    function updateBrokenStats(treeData) {
        let count = 0;
        const countRecursive = (nodes) => {
            nodes.forEach(node => {
                if (node.scrapeStatus === 'dead') count++;
                if (node.children) countRecursive(node.children);
            });
        };
        countRecursive(treeData);

        // Always show the controls container
        brokenControls.classList.remove('hidden');
        brokenCountEl.textContent = `💀 ${count}`;

        // Always show button, but disable if 0
        removeBrokenBtn.classList.remove('hidden');
        if (count > 0) {
            removeBrokenBtn.disabled = false;
            removeBrokenBtn.style.opacity = '1';
            removeBrokenBtn.style.cursor = 'pointer';
            removeBrokenBtn.title = "Remove all broken links";
        } else {
            removeBrokenBtn.disabled = true;
            removeBrokenBtn.style.opacity = '0.3';
            removeBrokenBtn.style.cursor = 'default';
            removeBrokenBtn.title = "No broken links to remove";
        }
    }

    // Duplicate Link Controls
    const duplicateControls = document.getElementById('duplicate-link-controls');
    const duplicateCountEl = document.getElementById('duplicate-count');
    const removeDuplicatesBtn = document.getElementById('remove-duplicates-btn');

    function updateDuplicateStats() {
        // First check if we have metadata from backend
        if (currentMetadata && currentMetadata.duplicateCount !== undefined) {
            duplicateControls.classList.remove('hidden');
            duplicateCountEl.textContent = `🔗 ${currentMetadata.duplicateCount} duplicates`;

            removeDuplicatesBtn.classList.remove('hidden');
            if (currentMetadata.duplicateCount > 0) {
                removeDuplicatesBtn.disabled = false;
                removeDuplicatesBtn.style.opacity = '1';
                removeDuplicatesBtn.style.cursor = 'pointer';
                removeDuplicatesBtn.title = "Remove all duplicate links";
            } else {
                removeDuplicatesBtn.disabled = true;
                removeDuplicatesBtn.style.opacity = '0.3';
                removeDuplicatesBtn.style.cursor = 'default';
                removeDuplicatesBtn.title = "No duplicates to remove";
            }
            return;
        }

        // Fallback: count duplicates in tree if metadata not available
        if (!currentProposedStructure) {
            duplicateControls.classList.add('hidden');
            return;
        }

        let count = 0;
        const countRecursive = (nodes) => {
            nodes.forEach(node => {
                if (node.isDuplicate) count++;
                if (node.children) countRecursive(node.children);
            });
        };
        countRecursive(currentProposedStructure);

        if (count > 0) {
            duplicateControls.classList.remove('hidden');
            duplicateCountEl.textContent = `🔗 ${count} duplicates`;

            removeDuplicatesBtn.classList.remove('hidden');
            removeDuplicatesBtn.disabled = false;
            removeDuplicatesBtn.style.opacity = '1';
            removeDuplicatesBtn.style.cursor = 'pointer';
            removeDuplicatesBtn.title = "Remove all duplicate links";
        } else {
            // For duplicates, we can hide the whole control if 0, OR show it disabled.
            // User asked to show dead links even if 0. 
            // Let's show duplicates even if 0 for consistency?
            // "The UI ... should show the amount of dead links ... and also the amount of redundant duplicate links"
            // So yes, show even if 0.

            duplicateControls.classList.remove('hidden');
            duplicateCountEl.textContent = `🔗 0 duplicates`;

            removeDuplicatesBtn.classList.remove('hidden');
            removeDuplicatesBtn.disabled = true;
            removeDuplicatesBtn.style.opacity = '0.3';
            removeDuplicatesBtn.style.cursor = 'default';
            removeDuplicatesBtn.title = "No duplicates to remove";
        }
    }

    if (removeBrokenBtn) {
        removeBrokenBtn.addEventListener('click', () => {
            if (!currentProposedStructure) return;

            if (confirm("Remove all broken links from the proposed structure?")) {
                const filterRecursive = (nodes) => {
                    return nodes.filter(node => {
                        if (node.scrapeStatus === 'dead') return false;
                        if (node.children) {
                            node.children = filterRecursive(node.children);
                            // Remove empty folders if they became empty
                            if (node.children.length === 0 && node.title !== "LinkLoom Organized") {
                                return false;
                            }
                        }
                        return true;
                    });
                };

                currentProposedStructure = filterRecursive(currentProposedStructure);
                renderTree(currentProposedStructure, treePreview);
            }
        });
    }

    if (removeDuplicatesBtn) {
        removeDuplicatesBtn.addEventListener('click', () => {
            if (!currentProposedStructure) return;

            if (confirm("Remove all duplicate links from the proposed structure? Only the first occurrence of each URL will be kept.")) {
                const filterRecursive = (nodes) => {
                    return nodes.filter(node => {
                        if (node.isDuplicate) return false;
                        if (node.children) {
                            node.children = filterRecursive(node.children);
                            // Remove empty folders if they became empty
                            if (node.children.length === 0 && node.title !== "LinkLoom Organized") {
                                return false;
                            }
                        }
                        return true;
                    });
                };

                currentProposedStructure = filterRecursive(currentProposedStructure);
                // Update metadata if it exists
                if (currentMetadata) {
                    currentMetadata.duplicateCount = 0;
                }
                renderTree(currentProposedStructure, treePreview);
                updateDuplicateStats();
            }
        });
    }


    function getMockData() {
        return [
            {
                title: "Development",
                children: [
                    { title: "GitHub - LinkLoom", url: "https://github.com/..." },
                    { title: "Stack Overflow", url: "https://stackoverflow.com" }
                ]
            },
            {
                title: "News",
                children: [
                    { title: "Hacker News", url: "https://news.ycombinator.com" },
                    { title: "TechCrunch", url: "https://techcrunch.com" }
                ]
            },
            {
                title: "Uncategorized",
                children: [
                    { title: "Random Recipe", url: "https://allrecipes.com" }
                ]
            }
        ];
    }

    function showToast(message, type = 'info', actionLabel = null, actionCallback = null) {
        const container = document.getElementById('toast-container');
        const msgEl = document.getElementById('toast-message');

        // Clear previous content
        msgEl.innerHTML = '';
        msgEl.textContent = message;

        // Remove existing action button if any
        const existingBtn = container.querySelector('.toast-action-btn');
        if (existingBtn) existingBtn.remove();

        if (actionLabel && actionCallback) {
            const btn = document.createElement('button');
            btn.className = 'toast-action-btn'; // Need to add CSS for this
            btn.textContent = actionLabel;
            btn.style.marginLeft = '10px';
            btn.style.padding = '4px 8px';
            btn.style.background = 'white';
            btn.style.color = 'black';
            btn.style.border = 'none';
            btn.style.borderRadius = '4px';
            btn.style.cursor = 'pointer';

            btn.onclick = () => {
                actionCallback();
                container.classList.add('hidden');
            };
            container.appendChild(btn);
        }

        container.classList.remove('hidden');

        // Auto hide only if no action
        if (!actionLabel) {
            setTimeout(() => {
                container.classList.add('hidden');
            }, 3000);
        }
    }
});
