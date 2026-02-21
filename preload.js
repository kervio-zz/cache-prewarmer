const puppeteer = require('puppeteer');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

// Configuration
const SITE_URL = 'https://parler-et-revivre.fr';
const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;
const DELAY_BETWEEN_PAGES = 2000; // 2 secondes entre chaque page
const PURGE_URL = `${SITE_URL}/cache-purge.php?key=7c447a1f8a51856e8b2551135981ca19fd50173de0b7b5502d9d0132883c5c9f`;

async function getSitemapUrls(sitemapUrl) {
  try {
    console.log(`📥 Récupération du sitemap: ${sitemapUrl}`);
    const response = await axios.get(sitemapUrl);
    const result = await parseStringPromise(response.data);
    
    const urls = [];
    
    // Sitemap simple
    if (result.urlset && result.urlset.url) {
      return result.urlset.url.map(u => u.loc[0]);
    }
    // Sitemap index (contient d'autres sitemaps)
    else if (result.sitemapindex && result.sitemapindex.sitemap) {
      console.log('📋 Sitemap index détecté, récupération des sous-sitemaps...');
      for (const sitemap of result.sitemapindex.sitemap) {
        const subUrls = await getSitemapUrls(sitemap.loc[0]);
        urls.push(...subUrls);
      }
    }
    
    return urls;
  } catch (error) {
    console.error('❌ Erreur lors de la récupération du sitemap:', error.message);
    return [];
  }
}

async function preloadCache() {
  console.log('🚀 Démarrage du préchargement du cache WordPress\n');
  
  // Purger le cache via le fichier PHP
  console.log('🗑️ Purge du cache WordPress...');
  try {
    const response = await axios.get(PURGE_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'CachePrewarmer/1.0' }
    });
    console.log(`✅ ${response.data}`);
    console.log('⏳ Attente de 10 secondes pour que la purge soit effective...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));
  } catch (error) {
    console.log('❌ Erreur de purge:', error.message);
    console.log('⚠️ Le préchargement va continuer mais peut afficher d\'anciennes versions\n');
  }
  
  // Récupérer toutes les URLs du sitemap
  let urls = await getSitemapUrls(SITEMAP_URL);
  
  if (urls.length === 0) {
    console.log('⚠️ Aucune URL trouvée dans le sitemap');
    return;
  }
  
  console.log(`✅ ${urls.length} URLs trouvées\n`);
  
  // Exclure les URLs problématiques
  const urlsToExclude = [
    '/revue-de-presse/',
    '/saisie_bibliotheque/',
    '/saisie_videotheque/',
    '/espace-redaction/',
    '/saisie-agenda/',
    '/redaction-article/'
  ];
  
  urls = urls.filter(url => !urlsToExclude.some(excluded => url.includes(excluded)));
  console.log(`📋 ${urls.length} URLs après filtrage (${urlsToExclude.length} exclue(s))\n`);
  
  // Lancer le navigateur
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Configurer le viewport et user agent
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (compatible; CachePrewarmer/1.0)');
  
  let successCount = 0;
  let errorCount = 0;
  
  // Visiter chaque URL
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      console.log(`[${i + 1}/${urls.length}] 🔄 Chargement: ${url}`);
      
      // Charger la page et attendre que le réseau soit inactif
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Attendre un peu plus pour être sûr que tout est chargé
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log(`   ✅ Succès\n`);
      successCount++;
      
    } catch (error) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      errorCount++;
    }
    
    // Délai entre les pages pour ne pas surcharger le serveur
    if (i < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_PAGES));
    }
  }
  
  await browser.close();
  
  // Résumé
  console.log('\n' + '='.repeat(50));
  console.log('📊 RÉSUMÉ DU PRÉCHARGEMENT');
  console.log('='.repeat(50));
  console.log(`✅ Succès: ${successCount}`);
  console.log(`❌ Erreurs: ${errorCount}`);
  console.log(`📄 Total: ${urls.length}`);
  console.log('='.repeat(50));
}

// Exécuter le script
preloadCache().catch(console.error);
