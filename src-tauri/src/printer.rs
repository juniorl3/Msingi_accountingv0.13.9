//! Sends raw ESC/POS bytes to a receipt printer. Standard library only.
//!
//! Two ways to reach a printer:
//! * `network`: straight to the printer's IP address (normally port 9100). No drivers needed.
//! * `queue`:   to a print queue installed on this computer (for USB printers). Mac/Linux: `lp -o raw`. Windows: the print spooler in RAW mode.
//!
//! The same bytes carry the cash-drawer pulse, because the drawer is wired to the printer.

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::Duration;

/// A receipt is a few kilobytes; refuse anything absurd.
pub const MAX_BYTES: usize = 256 * 1024;

/// A host name or IP address: letters, digits, dot, dash, underscore, colon (IPv6). No spaces or anything a shell or URL could misread.
pub fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
}

/// A print-queue name as CUPS allows it (no spaces or slashes), so it can never be read as an option.
pub fn valid_queue(q: &str) -> bool {
    !q.is_empty() && q.len() <= 127 && !q.starts_with('-') && q.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// A Windows printer name: spaces, brackets and a leading `\\server\` are normal there. Control characters are not.
pub fn valid_win_queue(q: &str) -> bool {
    !q.trim().is_empty() && q.chars().count() <= 127 && !q.chars().any(|c| c.is_control())
}

fn check_size(data: &[u8]) -> Result<(), String> {
    if data.is_empty() {
        return Err("Nothing to print.".into());
    }
    if data.len() > MAX_BYTES {
        return Err("The print job is too large.".into());
    }
    Ok(())
}

/// Sends `data` to host:port over TCP. Fails with a readable message if the printer cannot be reached within `timeout_ms`.
pub fn send_network(host: &str, port: u16, data: &[u8], timeout_ms: u64) -> Result<(), String> {
    check_size(data)?;
    if !valid_host(host) {
        return Err("Enter the printer's IP address or name, for example 192.168.1.50.".into());
    }
    if port == 0 {
        return Err("Enter the printer's port (usually 9100).".into());
    }
    let timeout = Duration::from_millis(timeout_ms.clamp(500, 30_000));
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("Could not find a printer called {host}. Check the address."))?
        .collect();
    let mut last = String::from("no address");
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(mut stream) => {
                stream.set_write_timeout(Some(timeout)).map_err(|e| e.to_string())?;
                stream.write_all(data).map_err(|e| format!("Sending to the printer failed: {e}"))?;
                stream.flush().map_err(|e| format!("Sending to the printer failed: {e}"))?;
                // Give slow printers a moment to take the last bytes before the connection closes.
                std::thread::sleep(Duration::from_millis(150));
                let _ = stream.shutdown(std::net::Shutdown::Both);
                return Ok(());
            }
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("Could not reach the printer at {host}:{port} ({last}). Check it is on, connected to the network, and the address is right."))
}

/// How long `lp` or `lpstat` may take before we stop waiting. A stuck print system must never freeze a sale.
pub const QUEUE_TIMEOUT: Duration = Duration::from_secs(15);

/// Runs a command, feeding it `input`, and waits at most `limit`. Returns (success, stdout, stderr).
/// If the command ends early and closes its input, the write error is ignored and what it printed is still returned.
#[cfg(unix)]
fn run_limited(mut cmd: Command, input: &[u8], limit: Duration) -> Result<(bool, String, String), String> {
    use std::io::Read;
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Could not start the system print command: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Could not open the print command.")?;
    let data = input.to_vec();
    let writer = std::thread::spawn(move || { let _ = stdin.write_all(&data); });
    let mut out = child.stdout.take().ok_or("Could not read the print command.")?;
    let mut err = child.stderr.take().ok_or("Could not read the print command.")?;
    let rd_out = std::thread::spawn(move || { let mut s = String::new(); let _ = out.read_to_string(&mut s); s });
    let rd_err = std::thread::spawn(move || { let mut s = String::new(); let _ = err.read_to_string(&mut s); s });
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(st) => break st,
            None if started.elapsed() >= limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("The print system did not answer within {} seconds. Check the printer is on and not stuck, then try again.", limit.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    let _ = writer.join();
    Ok((status.success(), rd_out.join().unwrap_or_default(), rd_err.join().unwrap_or_default()))
}

/// Sends `data` to a print queue with `lp -d <queue> -o raw` (macOS and Linux). Checks the queue first so an
/// obviously switched-off or paused printer is reported before the job is accepted and then sits unprinted.
#[cfg(unix)]
pub fn send_queue(queue: &str, data: &[u8]) -> Result<(), String> {
    send_queue_with(queue, data, QUEUE_TIMEOUT)
}

#[cfg(unix)]
fn send_queue_with(queue: &str, data: &[u8], limit: Duration) -> Result<(), String> {
    check_size(data)?;
    if !valid_queue(queue) {
        return Err("Choose the printer's print queue.".into());
    }
    if let QueueState::Problem(why) = queue_state_unix(queue, limit) {
        return Err(why);
    }
    let mut cmd = Command::new("lp");
    cmd.args(["-d", queue, "-o", "raw"]);
    let (ok, _out, err) = run_limited(cmd, data, limit)?;
    if ok {
        Ok(())
    } else {
        let why = err.trim().to_string();
        Err(format!("The print queue {queue} refused the job{}", if why.is_empty() { ".".to_string() } else { format!(": {why}") }))
    }
}

/// What the print system says about one queue.
#[derive(Debug, PartialEq, Clone)]
pub enum QueueState {
    Ready,
    /// The queue exists but cannot print right now. The text is a readable reason.
    Problem(String),
    /// Nothing could be learned (for example `lpstat` is missing). Printing is still attempted.
    Unknown,
}

/// Reads `lpstat -p <queue>` output such as `printer X is idle.  enabled since ...` or `printer X disabled since ... -`.
pub fn parse_queue_status(queue: &str, out: &str) -> QueueState {
    let text = out.to_lowercase();
    if text.contains("unknown destination") || text.contains("invalid destination") || text.contains("does not exist") {
        return QueueState::Problem(format!("The print queue {queue} is not installed on this computer. Choose the printer again in the printer settings."));
    }
    if text.contains("disabled") {
        let why = out.lines().skip(1).map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("");
        let extra = if why.is_empty() { String::new() } else { format!(" ({why})") };
        return QueueState::Problem(format!("The printer {queue} is switched off or paused{extra}. Switch it on, check the USB cable, then resume it in the system printer list."));
    }
    if text.contains("not accepting") {
        return QueueState::Problem(format!("The print queue {queue} is not accepting jobs. Check the printer and resume the queue."));
    }
    if text.contains("is idle") || text.contains("now printing") || text.contains("enabled") {
        return QueueState::Ready;
    }
    QueueState::Unknown
}

#[cfg(unix)]
fn queue_state_unix(queue: &str, limit: Duration) -> QueueState {
    let mut cmd = Command::new("lpstat");
    cmd.args(["-p", queue]);
    match run_limited(cmd, &[], limit.min(Duration::from_secs(5))) {
        Ok((_ok, out, err)) => parse_queue_status(queue, &format!("{out}\n{err}")),
        Err(_) => QueueState::Unknown,
    }
}

#[cfg(windows)]
pub fn send_queue(queue: &str, data: &[u8]) -> Result<(), String> {
    check_size(data)?;
    if !valid_win_queue(queue) {
        return Err("Choose the printer's print queue.".into());
    }
    win::send_raw(queue, data)
}

#[cfg(all(not(unix), not(windows)))]
pub fn send_queue(_queue: &str, _data: &[u8]) -> Result<(), String> {
    Err("Printing through a system print queue is not available on this system. Use a network printer.".into())
}

/// Parses `lpstat -e` (one destination per line), keeping only names that are safe to pass to `lp`.
pub fn parse_queues(out: &str) -> Vec<String> {
    let mut v: Vec<String> = out.lines().map(|l| l.trim().to_string()).filter(|l| valid_queue(l)).collect();
    v.sort();
    v.dedup();
    v
}

#[cfg(unix)]
pub fn list_queues() -> Result<Vec<String>, String> {
    let out = Command::new("lpstat").arg("-e").output().map_err(|e| format!("Could not list printers: {e}"))?;
    Ok(parse_queues(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(windows)]
pub fn list_queues() -> Result<Vec<String>, String> {
    let mut v: Vec<String> = win::list()?.into_iter().filter(|n| valid_win_queue(n)).collect();
    v.sort();
    v.dedup();
    Ok(v)
}

#[cfg(all(not(unix), not(windows)))]
pub fn list_queues() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Is the network printer reachable? Opens and closes a connection without sending anything.
pub fn check_network(host: &str, port: u16, timeout_ms: u64) -> Result<(), String> {
    if !valid_host(host) {
        return Err("Enter the printer's IP address or name, for example 192.168.1.50.".into());
    }
    if port == 0 {
        return Err("Enter the printer's port (usually 9100).".into());
    }
    let timeout = Duration::from_millis(timeout_ms.clamp(500, 10_000));
    let addrs: Vec<_> = (host, port).to_socket_addrs().map_err(|_| format!("Could not find a printer called {host}. Check the address."))?.collect();
    let mut last = String::from("no address");
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(s) => { let _ = s.shutdown(std::net::Shutdown::Both); return Ok(()); }
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("The printer at {host}:{port} does not answer ({last}). Check it is on and connected to the network."))
}

/// Is the print queue installed and able to print? On Windows the spooler is asked to open the printer.
pub fn check_queue(queue: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        if !valid_queue(queue) { return Err("Choose the printer's print queue.".into()); }
        return match queue_state_unix(queue, QUEUE_TIMEOUT) { QueueState::Problem(why) => Err(why), _ => Ok(()) };
    }
    #[cfg(windows)]
    {
        if !valid_win_queue(queue) { return Err("Choose the printer's print queue.".into()); }
        return win::can_open(queue);
    }
    #[cfg(all(not(unix), not(windows)))]
    { let _ = queue; Err("Printing through a system print queue is not available on this system. Use a network printer.".into()) }
}

/// Windows print spooler, called directly (winspool.drv ships with Windows). Sends bytes untouched with the RAW data type,
/// so ESC/POS commands reach the printer exactly as with a network printer. Not testable off Windows.
#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::ptr::null;

    #[repr(C)]
    struct DocInfo1W { doc_name: *const u16, output_file: *const u16, datatype: *const u16 }
    #[repr(C)]
    struct PrinterInfo4W { name: *const u16, server: *const u16, attributes: u32 }

    #[link(name = "winspool")]
    extern "system" {
        fn OpenPrinterW(name: *const u16, handle: *mut *mut c_void, defaults: *const c_void) -> i32;
        fn StartDocPrinterW(handle: *mut c_void, level: u32, info: *const DocInfo1W) -> u32;
        fn WritePrinter(handle: *mut c_void, buf: *const c_void, len: u32, written: *mut u32) -> i32;
        fn EndDocPrinter(handle: *mut c_void) -> i32;
        fn ClosePrinter(handle: *mut c_void) -> i32;
        fn EnumPrintersW(flags: u32, name: *const u16, level: u32, buf: *mut u8, size: u32, needed: *mut u32, returned: *mut u32) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

    unsafe fn read_wide(p: *const u16) -> String {
        if p.is_null() { return String::new(); }
        let mut n = 0;
        while *p.add(n) != 0 { n += 1; }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }

    pub fn send_raw(queue: &str, data: &[u8]) -> Result<(), String> {
        unsafe {
            let name = wide(queue);
            let mut h: *mut c_void = std::ptr::null_mut();
            if OpenPrinterW(name.as_ptr(), &mut h, null()) == 0 {
                return Err(format!("Could not open the printer \"{queue}\". Check it is installed, switched on and connected."));
            }
            let doc = wide("Msingi receipt"); let kind = wide("RAW");
            let info = DocInfo1W { doc_name: doc.as_ptr(), output_file: null(), datatype: kind.as_ptr() };
            if StartDocPrinterW(h, 1, &info) == 0 {
                ClosePrinter(h);
                return Err(format!("The printer \"{queue}\" would not accept a print job."));
            }
            let mut sent = 0usize;
            let mut failed = false;
            while sent < data.len() {
                let mut written: u32 = 0;
                let chunk = (data.len() - sent).min(16 * 1024) as u32;
                if WritePrinter(h, data.as_ptr().add(sent) as *const c_void, chunk, &mut written) == 0 || written == 0 { failed = true; break; }
                sent += written as usize;
            }
            let ended = EndDocPrinter(h) != 0;
            ClosePrinter(h);
            if !failed && !ended { return Err(format!("The printer \"{queue}\" did not finish the print job. Check the printer and try again.")); }
            if failed { return Err(format!("Sending to the printer \"{queue}\" failed part way. Check the printer and try again.")); }
            Ok(())
        }
    }

    pub fn can_open(queue: &str) -> Result<(), String> {
        unsafe {
            let name = wide(queue);
            let mut h: *mut c_void = std::ptr::null_mut();
            if OpenPrinterW(name.as_ptr(), &mut h, null()) == 0 {
                return Err(format!("Could not open the printer \"{queue}\". Check it is installed, switched on and connected."));
            }
            ClosePrinter(h);
            Ok(())
        }
    }

    pub fn list() -> Result<Vec<String>, String> {
        const FLAGS: u32 = 0x2 | 0x4; // local printers and printers connected from a network share
        unsafe {
            let (mut needed, mut returned) = (0u32, 0u32);
            EnumPrintersW(FLAGS, null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut returned);
            if needed == 0 { return Ok(Vec::new()); }
            let mut buf = vec![0u64; (needed as usize + 7) / 8]; // 8-byte aligned
            if EnumPrintersW(FLAGS, null(), 4, buf.as_mut_ptr() as *mut u8, needed, &mut needed, &mut returned) == 0 {
                return Err("Could not list the printers on this computer.".into());
            }
            let items = buf.as_ptr() as *const PrinterInfo4W;
            Ok((0..returned as usize).map(|i| read_wide((*items.add(i)).name)).filter(|n| !n.is_empty()).collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn validates_hosts_and_queues() {
        for ok in ["192.168.1.50", "printer.local", "my-printer_1", "fe80::1"] {
            assert!(valid_host(ok), "{ok}");
        }
        for bad in ["", "a b", "x;rm", "http://x", "a/b", "$(x)"] {
            assert!(!valid_host(bad), "{bad}");
        }
        assert!(valid_queue("EPSON_TM_T20III") && valid_queue("Printer-1.local"));
        for bad in ["", "-d", "a b", "a/b", "a;b", "--help"] {
            assert!(!valid_queue(bad), "{bad}");
        }
    }

    #[test]
    fn windows_printer_names_allow_spaces_but_not_control_characters() {
        for ok in ["EPSON TM-T20II Receipt", "\\\\SHOP-PC\\XP-80C", "POS-80 (Copy 1)"] {
            assert!(valid_win_queue(ok), "{ok}");
        }
        for bad in ["", "   ", "a\nb", "a\0b"] {
            assert!(!valid_win_queue(bad), "{bad:?}");
        }
        assert!(!valid_win_queue(&"x".repeat(128)));
    }

    #[test]
    fn rejects_empty_and_oversized_jobs() {
        assert!(send_network("127.0.0.1", 9100, &[], 1000).is_err());
        assert!(send_network("127.0.0.1", 9100, &vec![0u8; MAX_BYTES + 1], 1000).is_err());
        assert!(send_network("bad host", 9100, &[1], 1000).unwrap_err().contains("IP address"));
        assert!(send_network("127.0.0.1", 0, &[1], 1000).unwrap_err().contains("port"));
    }

    #[test]
    fn delivers_every_byte_over_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let reader = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut got = Vec::new();
            s.read_to_end(&mut got).unwrap();
            got
        });
        // includes bytes that are not valid text: ESC @, drawer pulse, cut
        let mut data = vec![0x1b, 0x40, 0x1b, 0x70, 0x00, 25, 250];
        data.extend((0..=255u8).cycle().take(5000));
        data.extend([0x1d, 0x56, 0x42, 3]);
        send_network("127.0.0.1", port, &data, 2000).unwrap();
        assert_eq!(reader.join().unwrap(), data);
    }

    #[test]
    fn reports_an_unreachable_printer_clearly() {
        let port = { let l = TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() }; // closed again
        let e = send_network("127.0.0.1", port, &[1, 2, 3], 1000).unwrap_err();
        assert!(e.contains("Could not reach the printer"), "{e}");
    }

    #[test]
    fn parses_lpstat_output() {
        let q = parse_queues("EPSON_TM_T20III\n  Brother HL \nHP-LaserJet\nEPSON_TM_T20III\n-bad\n\n");
        assert_eq!(q, vec!["EPSON_TM_T20III".to_string(), "HP-LaserJet".to_string()]);
    }

    #[test]
    fn reads_queue_status_text() {
        assert_eq!(parse_queue_status("P", "printer P is idle.  enabled since Mon 16 Nov 2026\n"), QueueState::Ready);
        assert_eq!(parse_queue_status("P", "printer P now printing P-12.  enabled since Mon\n"), QueueState::Ready);
        match parse_queue_status("P", "printer P disabled since Mon 16 Nov -\n\treason unknown\n") { QueueState::Problem(m) => assert!(m.contains("switched off") && m.contains("reason unknown"), "{m}"), o => panic!("{o:?}") }
        match parse_queue_status("P", "lpstat: Invalid destination name P\n") { QueueState::Problem(m) => assert!(m.contains("not installed"), "{m}"), o => panic!("{o:?}") }
        match parse_queue_status("P", "Rejecting Jobs\nprinter P is idle. not accepting requests") { QueueState::Problem(m) => assert!(m.contains("not accepting"), "{m}"), o => panic!("{o:?}") }
        assert_eq!(parse_queue_status("P", ""), QueueState::Unknown);
    }

    #[test]
    fn network_check_connects_without_sending() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let h = std::thread::spawn(move || { let (mut s, _) = listener.accept().unwrap(); let mut got = Vec::new(); s.read_to_end(&mut got).unwrap(); got });
        check_network("127.0.0.1", port, 1000).unwrap();
        assert!(h.join().unwrap().is_empty());
        let closed = { let l = TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() };
        assert!(check_network("127.0.0.1", closed, 800).unwrap_err().contains("does not answer"));
        assert!(check_network("bad host", 9100, 800).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_stuck_print_command_is_stopped() {
        let mut cmd = Command::new("sleep"); cmd.arg("5");
        let t = std::time::Instant::now();
        let e = run_limited(cmd, b"x", Duration::from_millis(300)).unwrap_err();
        assert!(e.contains("did not answer") && t.elapsed() < Duration::from_secs(3), "{e}");
    }

    /// Uses fake `lp` and `lpstat` scripts first on PATH. This is the only test that touches PATH.
    #[cfg(unix)]
    #[test]
    fn sends_to_a_queue_with_lp_raw() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("msingi-lp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (args, body) = (dir.join("args.txt"), dir.join("body.bin"));
        let script = |name: &str, text: String| {
            let p = dir.join(name);
            std::fs::write(&p, text).unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        };
        script("lp", format!("#!/bin/sh\necho \"$@\" > {}\ncat > {}\n", args.display(), body.display()));
        script("lpstat", "#!/bin/sh\nif [ \"$1\" = \"-p\" ]; then echo \"printer $2 is idle.  enabled since today\"; else printf 'ReceiptPrinter\\nOffice-Laser\\n'; fi\n".to_string());
        let old = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", format!("{}:{old}", dir.display()));

        let data = vec![0x1b, 0x40, 0xff, 0x00, b'H', b'i', 0x1d, 0x56, 0x42, 3];
        send_queue("ReceiptPrinter", &data).unwrap();
        assert_eq!(std::fs::read_to_string(&args).unwrap().trim(), "-d ReceiptPrinter -o raw");
        assert_eq!(std::fs::read(&body).unwrap(), data);
        assert!(send_queue("bad queue", &data).is_err());
        assert_eq!(list_queues().unwrap(), vec!["Office-Laser".to_string(), "ReceiptPrinter".to_string()]);

        script("lp", "#!/bin/sh\ncat > /dev/null\necho 'lp: Unknown destination' >&2\nexit 1\n".to_string());
        let e = send_queue("ReceiptPrinter", &data).unwrap_err();
        assert!(e.contains("refused the job") && e.contains("Unknown destination"), "{e}");

        std::env::set_var("PATH", old);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
