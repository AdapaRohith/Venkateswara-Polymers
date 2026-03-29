const fs = require('fs');

try {
    let content = fs.readFileSync('src/components/Sidebar.jsx', 'utf8');

    // Remove My Stock from workerNavItems
    const myStockRegex = /\{\s*name:\s*'My Stock',\s*path:\s*'\/stocks'[\s\S]*?\},/;
    content = content.replace(myStockRegex, '');

    // Update Worker Mode text
    content = content.replace(/1\. Check stock[\s\S]*?2\. Run production session/, '1. Run production session');

    fs.writeFileSync('src/components/Sidebar.jsx', content);

    let workerHome = fs.readFileSync('src/pages/WorkerHome.jsx', 'utf8');
    workerHome = workerHome.replace('Just two things to do.', 'Ready for production.');

    const quickCardRegex = /<QuickCard\s+step=\"Step 1\"\s+title=\"Check My Stock\"\s+to=\"\/stocks\"\s+tone=\"blue\"\s*\/>/;
    workerHome = workerHome.replace(quickCardRegex, '');

    workerHome = workerHome.replace('step="Step 2"', 'step="Start"');
    
    // Fix grid-cols-2 for QuickCards section
    workerHome = workerHome.replace('<div className="grid grid-cols-1 gap-4 md:grid-cols-2">\\n        <QuickCard\\n          step="Start"', '<div className="grid grid-cols-1 gap-4 md:grid-cols-1">\\n        <QuickCard\\n          step="Start"');

    // More aggressive grid fix if regex didn't match:
    workerHome = workerHome.replace(/<div className=\"grid grid-cols-1 gap-4 md:grid-cols-2\">\s*<QuickCard\s+step=\"Start\"/, '<div className=\"grid grid-cols-1 gap-4 md:grid-cols-1\">\n        <QuickCard\n          step=\"Start\"');


    fs.writeFileSync('src/pages/WorkerHome.jsx', workerHome);
    console.log('Update script completed successfully!');
} catch (e) {
    console.error('Error applying updates:', e);
}
