# AccEquMotoMec

PWA per la consultazione degli **accessori per equilibratura moto** del catalogo Cormach MEC (Rev. 02/2025). Caricando il file Excel del listino, l'app mostra anche i prezzi netti accanto a ogni codice.

![AccEquMotoMec](./icons/icon-512.png)

## Caratteristiche

- **Consultazione offline**: dopo la prima apertura l'app funziona anche senza connessione (service worker).
- **Installabile**: è una PWA, si installa su smartphone, tablet e desktop dalla homepage del browser.
- **Prezzi runtime**: il listino NON è dentro al codice. L'app legge il foglio `02_Codici_unici` dal file Excel che carichi tu, in colonna I trova i prezzi netti. Dove il prezzo è 0 o mancante mostra _"prodotto non fornibile"_.
- **Privacy**: il file Excel non esce mai dal tuo dispositivo. I prezzi decodificati restano in `localStorage` e si possono rimuovere in qualsiasi momento.
- **Ricerca e filtri**: ricerca full-text su codice / descrizione / compatibilità, più filtri per diametro albero (Ø14, Ø18, 3/4", Ø40).
- **36 articoli** organizzati nelle 6 sezioni del catalogo + riferimenti accessori richiesti.

## Uso

1. Apri l'app (link alla versione online più in basso).
2. Premi **Carica listino** e seleziona il file Excel con il foglio `02_Codici_unici`.
3. Usa la ricerca e i filtri per trovare l'articolo.
4. Tocca una scheda per vedere il dettaglio completo (codice, compatibilità, albero, pagina catalogo, prezzo netto).

### Struttura attesa del file Excel

L'ultimo foglio deve contenere almeno:

| Colonna | Contenuto |
|--------:|----------|
| A       | Codice (es. `21100022`, `41200279A`) |
| I       | Prezzo listino netto in € (numerico; 0 o vuoto = non fornibile) |

L'app comunque cerca automaticamente l'intestazione con testo "Codice" e "Prezzo ... netto" nelle prime 10 righe, quindi anche piccoli spostamenti dell'header vengono gestiti.

## Installazione locale (sviluppo)

È una PWA **zero-build**: non serve Node, non serve npm. Basta un qualunque server HTTP statico.

```bash
# clona la repo
git clone https://github.com/<tuo-utente>/AccEquMotoMec.git
cd AccEquMotoMec

# server statico in locale
python3 -m http.server 8000
# oppure:  npx serve .
```

Poi apri <http://localhost:8000>.

## Deploy

### GitHub Pages (automatico)

La repo include un workflow GitHub Actions (`.github/workflows/deploy.yml`) che pubblica automaticamente su GitHub Pages ad ogni push su `main`.

Per attivarlo:

1. Push della repo su GitHub.
2. Vai in **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. Al prossimo push su `main` la PWA è online all'indirizzo  
   `https://<tuo-utente>.github.io/AccEquMotoMec/`

### Altri hosting

Funziona su qualsiasi hosting statico (Netlify, Cloudflare Pages, un Apache / nginx). Serve solo HTTPS perché i service worker (e quindi la funzionalità offline) richiedono una connessione sicura.

## Struttura dei file

```
AccEquMotoMec/
├── index.html              # markup dell'app
├── style.css               # tema scuro industriale
├── app.js                  # logica, parsing Excel, filtri, drawer
├── data.js                 # anagrafica codici (SENZA prezzi)
├── sw.js                   # service worker (cache offline)
├── manifest.webmanifest    # PWA manifest
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
├── vendor/
│   └── xlsx.full.min.js    # SheetJS (lettura file .xlsx)
└── .github/workflows/
    └── deploy.yml          # deploy automatico su GitHub Pages
```

## Manutenzione: aggiungere o correggere un codice

Modifica `data.js`:

```js
"NUOVO_CODICE": {
  code: "NUOVO_CODICE",
  title: "DESCRIZIONE BREVE",
  desc:  "Descrizione estesa tecnica.",
  shaft: "Ø18",
  compat: "Modelli / marche supportati",
  page: 12
},
```

e aggiungi il codice nell'array `codes` della sezione corrispondente (`sections`).

## Credits

- Dati catalogo: **Cormach S.r.l.** — via A. Pignedoli, 2 — 42015 Correggio (RE), Italy — <https://www.cormachsrl.com>
- SheetJS (Apache 2.0): <https://sheetjs.com>

## Licenza

Codice applicativo rilasciato sotto licenza MIT (vedi `LICENSE`).  
I dati del catalogo, i codici, le immagini e i nomi dei prodotti sono **proprietà di Cormach S.r.l.** e vengono usati esclusivamente per la consultazione interna da parte di rivenditori autorizzati e clienti.
