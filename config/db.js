// const mysql = require("mysql");
// const util = require("util");
// const db = mysql.createConnection({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "test_yaya_link"
// });

// //Create a Connection to Database

// db.connect((err)=>{
//     if(err!=null){
//         console.log('No Connect to database')
        
//     }else{
//         console.log('💾 Connect to database')
//     }
    
// })
// // Promisify for async/await
// db.query = util.promisify(db.query);
// module.exports = db;
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

pool.on('connection', () => {
  console.log('✅ MySQL pool connection established');
});

module.exports = pool;
