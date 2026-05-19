import pool from "../services/db.js";

export const testapi = async(req, res) => {
    try {
        const {rows} = await pool.query("select * from testtable");
        res.json(rows);
    } catch(e) {
        console.error(e);
        res.status(e.status || 500).json({message: e.message})
    }
}