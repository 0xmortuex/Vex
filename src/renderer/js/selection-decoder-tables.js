// === Lookup tables for the selection decoder ====================================
//
// Offline tables and parsers behind "Decode selection" (js/selection-decoder.js): errno, Win32 and Winsock
// error numbers, NTSTATUS / HRESULT, EFI_STATUS, HTTP status codes, signals (and shell exit codes 128+N) and cron
// expressions. Everything is a local table in this file: nothing is looked up on the internet, nothing is sent
// or kept. The tables hold the values people actually meet in a crash, a log or a build; a number that is not
// in a table is said not to be in it (the decoder never guesses a name).
//
// All functions are pure; the clock is passed in. Tested in tests/renderer/selectionDecoderTables.test.js.
const VexDecodeTables = {
  // ---- HTTP -------------------------------------------------------------------------------------------------
  HTTP: {
    100: ['Continue', 'The server got the request headers; the client may send the body.'],
    101: ['Switching Protocols', 'The server agrees to change protocol (for example to WebSocket).'],
    102: ['Processing', 'WebDAV: the server is working on the request.'],
    103: ['Early Hints', 'The server sends headers early so the browser can preload resources.'],
    200: ['OK', 'The request worked.'],
    201: ['Created', 'The request worked and made a new resource.'],
    202: ['Accepted', 'The request was taken but is not finished yet.'],
    203: ['Non-Authoritative Information', 'A proxy changed the answer of the origin server.'],
    204: ['No Content', 'It worked and there is nothing to send back.'],
    205: ['Reset Content', 'It worked; the client should reset the form or view.'],
    206: ['Partial Content', 'Only the byte range that was asked for is returned (video, resumed downloads).'],
    207: ['Multi-Status', 'WebDAV: several results in one answer.'],
    226: ['IM Used', 'The answer is the result of instance manipulations (delta encoding).'],
    300: ['Multiple Choices', 'There is more than one possible answer.'],
    301: ['Moved Permanently', 'The address has changed for good; use the new one.'],
    302: ['Found', 'Temporary redirect; keep using the old address.'],
    303: ['See Other', 'Look at another address with GET (the normal answer after a POST).'],
    304: ['Not Modified', 'The cached copy is still good.'],
    307: ['Temporary Redirect', 'Temporary redirect that keeps the method and body.'],
    308: ['Permanent Redirect', 'Permanent redirect that keeps the method and body.'],
    400: ['Bad Request', 'The server could not understand the request (bad syntax, size or framing).'],
    401: ['Unauthorized', 'Sign-in is needed or the credentials are wrong.'],
    402: ['Payment Required', 'Reserved; some APIs use it for billing limits.'],
    403: ['Forbidden', 'The server understood but refuses: you are not allowed.'],
    404: ['Not Found', 'There is nothing at this address.'],
    405: ['Method Not Allowed', 'The address exists but not for this method (GET, POST ...).'],
    406: ['Not Acceptable', 'The server cannot produce an answer in the formats the client accepts.'],
    407: ['Proxy Authentication Required', 'The proxy wants credentials first.'],
    408: ['Request Timeout', 'The server gave up waiting for the request.'],
    409: ['Conflict', 'The request conflicts with the current state of the resource.'],
    410: ['Gone', 'It was here and was removed on purpose.'],
    411: ['Length Required', 'The request needs a Content-Length.'],
    412: ['Precondition Failed', 'An If-... header in the request was not true.'],
    413: ['Content Too Large', 'The request body is bigger than the server accepts.'],
    414: ['URI Too Long', 'The address is longer than the server accepts.'],
    415: ['Unsupported Media Type', 'The server does not accept the body format (Content-Type).'],
    416: ['Range Not Satisfiable', 'The requested byte range is outside the file.'],
    417: ['Expectation Failed', 'The Expect header could not be met.'],
    418: ['I\'m a teapot', 'A joke status from RFC 2324; some servers use it to refuse bots.'],
    421: ['Misdirected Request', 'The request went to a server that cannot answer for this host.'],
    422: ['Unprocessable Content', 'The syntax is fine but the content is not acceptable (validation failed).'],
    423: ['Locked', 'WebDAV: the resource is locked.'],
    424: ['Failed Dependency', 'WebDAV: an earlier request this one depends on failed.'],
    425: ['Too Early', 'The server will not risk replaying a request that may be replayed.'],
    426: ['Upgrade Required', 'The client must switch to another protocol.'],
    428: ['Precondition Required', 'The server wants the request to be conditional.'],
    429: ['Too Many Requests', 'Rate limit: slow down; Retry-After may say when to come back.'],
    431: ['Request Header Fields Too Large', 'The headers (often cookies) are too big.'],
    451: ['Unavailable For Legal Reasons', 'Blocked because of a legal demand.'],
    500: ['Internal Server Error', 'The server failed in a way it did not expect.'],
    501: ['Not Implemented', 'The server does not support what was asked.'],
    502: ['Bad Gateway', 'A gateway or proxy got a bad answer from the server behind it.'],
    503: ['Service Unavailable', 'The server is overloaded or down for maintenance.'],
    504: ['Gateway Timeout', 'A gateway or proxy waited too long for the server behind it.'],
    505: ['HTTP Version Not Supported', 'The server does not support this HTTP version.'],
    506: ['Variant Also Negotiates', 'A configuration error in content negotiation.'],
    507: ['Insufficient Storage', 'WebDAV: the server is out of space.'],
    508: ['Loop Detected', 'WebDAV: an endless loop was found.'],
    510: ['Not Extended', 'The server needs more extensions to answer.'],
    511: ['Network Authentication Required', 'A network (captive portal) wants a login first.'],
    520: ['Web Server Returned an Unknown Error', 'Cloudflare: the origin server answered with something unexpected.'],
    521: ['Web Server Is Down', 'Cloudflare: the origin server refused the connection.'],
    522: ['Connection Timed Out', 'Cloudflare: the origin server did not answer the connection in time.'],
    523: ['Origin Is Unreachable', 'Cloudflare: the origin server cannot be reached.'],
    524: ['A Timeout Occurred', 'Cloudflare: the origin accepted the connection but did not answer in time.'],
    525: ['SSL Handshake Failed', 'Cloudflare: the TLS handshake with the origin failed.'],
    526: ['Invalid SSL Certificate', 'Cloudflare: the origin certificate is not valid.'],
  },
  http(code) {
    const e = this.HTTP[Number(code)];
    if (!e) return null;
    const n = Number(code);
    const cls = n < 200 ? 'Informational' : n < 300 ? 'Success' : n < 400 ? 'Redirection' : n < 500 ? 'Client error' : 'Server error';
    return { code: n, name: e[0], meaning: e[1], family: cls };
  },

  // ---- errno (Linux numbers; the names are the same on macOS and Windows C runtimes, the numbers are not) ----------
  ERRNO: {
    1: ['EPERM', 'Operation not permitted'], 2: ['ENOENT', 'No such file or directory'], 3: ['ESRCH', 'No such process'], 4: ['EINTR', 'Interrupted system call'],
    5: ['EIO', 'Input/output error'], 6: ['ENXIO', 'No such device or address'], 7: ['E2BIG', 'Argument list too long'], 8: ['ENOEXEC', 'Exec format error'],
    9: ['EBADF', 'Bad file descriptor'], 10: ['ECHILD', 'No child processes'], 11: ['EAGAIN', 'Resource temporarily unavailable (try again)'], 12: ['ENOMEM', 'Cannot allocate memory'],
    13: ['EACCES', 'Permission denied'], 14: ['EFAULT', 'Bad address'], 16: ['EBUSY', 'Device or resource busy'], 17: ['EEXIST', 'File exists'],
    18: ['EXDEV', 'Invalid cross-device link'], 19: ['ENODEV', 'No such device'], 20: ['ENOTDIR', 'Not a directory'], 21: ['EISDIR', 'Is a directory'],
    22: ['EINVAL', 'Invalid argument'], 23: ['ENFILE', 'Too many open files in system'], 24: ['EMFILE', 'Too many open files'], 25: ['ENOTTY', 'Inappropriate ioctl for device'],
    26: ['ETXTBSY', 'Text file busy'], 27: ['EFBIG', 'File too large'], 28: ['ENOSPC', 'No space left on device'], 29: ['ESPIPE', 'Illegal seek'],
    30: ['EROFS', 'Read-only file system'], 31: ['EMLINK', 'Too many links'], 32: ['EPIPE', 'Broken pipe'], 33: ['EDOM', 'Numerical argument out of domain'],
    34: ['ERANGE', 'Numerical result out of range'], 35: ['EDEADLK', 'Resource deadlock avoided'], 36: ['ENAMETOOLONG', 'File name too long'], 38: ['ENOSYS', 'Function not implemented'],
    39: ['ENOTEMPTY', 'Directory not empty'], 40: ['ELOOP', 'Too many levels of symbolic links'], 61: ['ENODATA', 'No data available'], 62: ['ETIME', 'Timer expired'],
    71: ['EPROTO', 'Protocol error'], 75: ['EOVERFLOW', 'Value too large for defined data type'], 84: ['EILSEQ', 'Invalid or incomplete multibyte or wide character'],
    88: ['ENOTSOCK', 'Socket operation on non-socket'], 90: ['EMSGSIZE', 'Message too long'], 92: ['ENOPROTOOPT', 'Protocol not available'], 95: ['EOPNOTSUPP', 'Operation not supported'],
    97: ['EAFNOSUPPORT', 'Address family not supported'], 98: ['EADDRINUSE', 'Address already in use'], 99: ['EADDRNOTAVAIL', 'Cannot assign requested address'],
    100: ['ENETDOWN', 'Network is down'], 101: ['ENETUNREACH', 'Network is unreachable'], 103: ['ECONNABORTED', 'Software caused connection abort'],
    104: ['ECONNRESET', 'Connection reset by peer'], 105: ['ENOBUFS', 'No buffer space available'], 106: ['EISCONN', 'Transport endpoint is already connected'],
    107: ['ENOTCONN', 'Transport endpoint is not connected'], 110: ['ETIMEDOUT', 'Connection timed out'], 111: ['ECONNREFUSED', 'Connection refused'],
    112: ['EHOSTDOWN', 'Host is down'], 113: ['EHOSTUNREACH', 'No route to host'], 114: ['EALREADY', 'Operation already in progress'], 115: ['EINPROGRESS', 'Operation now in progress'],
    116: ['ESTALE', 'Stale file handle'], 122: ['EDQUOT', 'Disk quota exceeded'], 125: ['ECANCELED', 'Operation canceled'],
  },
  // Name -> number (built once).
  _errnoByName: null,
  errno(key) {
    if (!this._errnoByName) {
      this._errnoByName = {};
      for (const [n, v] of Object.entries(this.ERRNO)) this._errnoByName[v[0]] = Number(n);
      this._errnoByName.EWOULDBLOCK = 11; this._errnoByName.EDEADLOCK = 35;
    }
    const k = String(key).trim();
    const n = /^\d+$/.test(k) ? Number(k) : this._errnoByName[k.toUpperCase()];
    const e = n == null ? null : this.ERRNO[n];
    if (!e) return null;
    return { number: n, name: e[0], meaning: e[1] };
  },

  // ---- Windows error numbers (GetLastError / WSAGetLastError) -----------------------------------------------------
  WIN32: {
    0: ['ERROR_SUCCESS', 'The operation completed successfully.'], 1: ['ERROR_INVALID_FUNCTION', 'Incorrect function.'], 2: ['ERROR_FILE_NOT_FOUND', 'The system cannot find the file specified.'],
    3: ['ERROR_PATH_NOT_FOUND', 'The system cannot find the path specified.'], 4: ['ERROR_TOO_MANY_OPEN_FILES', 'The system cannot open the file (too many open files).'],
    5: ['ERROR_ACCESS_DENIED', 'Access is denied.'], 6: ['ERROR_INVALID_HANDLE', 'The handle is invalid.'], 8: ['ERROR_NOT_ENOUGH_MEMORY', 'Not enough memory resources are available.'],
    14: ['ERROR_OUTOFMEMORY', 'Not enough memory to complete the operation.'], 15: ['ERROR_INVALID_DRIVE', 'The system cannot find the drive specified.'],
    32: ['ERROR_SHARING_VIOLATION', 'The process cannot access the file because it is being used by another process.'], 33: ['ERROR_LOCK_VIOLATION', 'Another process has locked a portion of the file.'],
    53: ['ERROR_BAD_NETPATH', 'The network path was not found.'], 64: ['ERROR_NETNAME_DELETED', 'The specified network name is no longer available.'],
    80: ['ERROR_FILE_EXISTS', 'The file exists.'], 87: ['ERROR_INVALID_PARAMETER', 'The parameter is incorrect.'], 112: ['ERROR_DISK_FULL', 'There is not enough space on the disk.'],
    122: ['ERROR_INSUFFICIENT_BUFFER', 'The data area passed to a system call is too small.'], 126: ['ERROR_MOD_NOT_FOUND', 'The specified module could not be found (a DLL is missing).'],
    127: ['ERROR_PROC_NOT_FOUND', 'The specified procedure could not be found.'], 183: ['ERROR_ALREADY_EXISTS', 'Cannot create a file when that file already exists.'],
    193: ['ERROR_BAD_EXE_FORMAT', 'The program is not a valid Win32 application (wrong architecture or damaged).'], 267: ['ERROR_DIRECTORY', 'The directory name is invalid.'],
    740: ['ERROR_ELEVATION_REQUIRED', 'The requested operation requires elevation (run as administrator).'], 1223: ['ERROR_CANCELLED', 'The operation was canceled by the user.'],
    1450: ['ERROR_NO_SYSTEM_RESOURCES', 'Insufficient system resources exist to complete the requested service.'],
    10013: ['WSAEACCES', 'Permission denied (a socket permission, often the firewall).'], 10035: ['WSAEWOULDBLOCK', 'A non-blocking socket operation could not be completed immediately.'],
    10048: ['WSAEADDRINUSE', 'Only one usage of each socket address is normally permitted (the port is in use).'], 10049: ['WSAEADDRNOTAVAIL', 'The requested address is not valid in this context.'],
    10050: ['WSAENETDOWN', 'The network is down.'], 10051: ['WSAENETUNREACH', 'The network is unreachable.'], 10053: ['WSAECONNABORTED', 'The connection was aborted by the local software.'],
    10054: ['WSAECONNRESET', 'The connection was reset by the remote host.'], 10055: ['WSAENOBUFS', 'No buffer space available.'], 10060: ['WSAETIMEDOUT', 'The connection attempt timed out.'],
    10061: ['WSAECONNREFUSED', 'The connection was refused (nothing is listening on that port).'], 10065: ['WSAEHOSTUNREACH', 'No route to the host.'], 11001: ['WSAHOST_NOT_FOUND', 'The host name could not be resolved.'],
  },
  win32(n) {
    const e = this.WIN32[Number(n)];
    return e ? { number: Number(n), name: e[0], meaning: e[1] } : null;
  },

  // ---- NTSTATUS and HRESULT (32-bit) -----------------------------------------------------------------------------
  NTSTATUS: {
    0x00000000: ['STATUS_SUCCESS', 'The operation completed successfully.'],
    0x00000103: ['STATUS_PENDING', 'The operation is still in progress.'],
    0x40000015: ['STATUS_FATAL_APP_EXIT', 'The application exited on its own with a fatal error.'],
    0x80000002: ['STATUS_DATATYPE_MISALIGNMENT', 'A misaligned data access.'],
    0x80000003: ['STATUS_BREAKPOINT', 'A breakpoint was hit (often a debug assertion or a failed check in the program).'],
    0x80000004: ['STATUS_SINGLE_STEP', 'A single-step trap.'],
    0x80000005: ['STATUS_BUFFER_OVERFLOW', 'The data was too large to fit the buffer; only part was returned.'],
    0x8000001A: ['STATUS_NO_MORE_ENTRIES', 'No more entries to return.'],
    0xC0000001: ['STATUS_UNSUCCESSFUL', 'The requested operation was unsuccessful.'],
    0xC0000002: ['STATUS_NOT_IMPLEMENTED', 'The requested operation is not implemented.'],
    0xC0000005: ['STATUS_ACCESS_VIOLATION', 'The program read or wrote memory it may not touch (a crash: bad pointer, bug or a hook).'],
    0xC0000008: ['STATUS_INVALID_HANDLE', 'An invalid handle was used.'],
    0xC000000D: ['STATUS_INVALID_PARAMETER', 'An invalid parameter was passed to a service.'],
    0xC000000F: ['STATUS_NO_SUCH_FILE', 'The file does not exist.'],
    0xC0000010: ['STATUS_INVALID_DEVICE_REQUEST', 'The request is not valid for this device.'],
    0xC0000017: ['STATUS_NO_MEMORY', 'Not enough virtual memory or paging file quota is available.'],
    0xC000001D: ['STATUS_ILLEGAL_INSTRUCTION', 'The CPU was asked to run an instruction it does not support (wrong build, or damaged code).'],
    0xC0000022: ['STATUS_ACCESS_DENIED', 'Access was denied by security.'],
    0xC0000034: ['STATUS_OBJECT_NAME_NOT_FOUND', 'The object name was not found.'],
    0xC0000035: ['STATUS_OBJECT_NAME_COLLISION', 'The object name already exists.'],
    0xC0000043: ['STATUS_SHARING_VIOLATION', 'The file is in use by another process.'],
    0xC000005A: ['STATUS_INVALID_OWNER', 'The security descriptor owner is not valid.'],
    0xC0000094: ['STATUS_INTEGER_DIVIDE_BY_ZERO', 'An integer division by zero.'],
    0xC0000096: ['STATUS_PRIVILEGED_INSTRUCTION', 'An instruction that only the system may run was attempted.'],
    0xC000009A: ['STATUS_INSUFFICIENT_RESOURCES', 'Insufficient system resources.'],
    0xC00000BA: ['STATUS_FILE_IS_A_DIRECTORY', 'The file is a directory.'],
    0xC00000FD: ['STATUS_STACK_OVERFLOW', 'The stack ran out (usually endless recursion).'],
    0xC0000102: ['STATUS_FILE_CORRUPT_ERROR', 'The file or directory is corrupt and unreadable.'],
    0xC0000135: ['STATUS_DLL_NOT_FOUND', 'A required DLL could not be found (the program fails at start).'],
    0xC0000138: ['STATUS_ORDINAL_NOT_FOUND', 'A DLL does not export a function the program expects (version mismatch).'],
    0xC0000139: ['STATUS_ENTRYPOINT_NOT_FOUND', 'A DLL does not export a function the program expects (version mismatch).'],
    0xC000013A: ['STATUS_CONTROL_C_EXIT', 'The program was ended with Ctrl+C.'],
    0xC0000142: ['STATUS_DLL_INIT_FAILED', 'A DLL failed to initialise (the program could not start).'],
    0xC0000194: ['STATUS_POSSIBLE_DEADLOCK', 'A possible deadlock was detected.'],
    0xC000007B: ['STATUS_INVALID_IMAGE_FORMAT', 'The program or a DLL is for a different architecture (32 against 64 bit) or damaged.'],
    0xC0000225: ['STATUS_NOT_FOUND', 'The object was not found.'],
    0xC0000374: ['STATUS_HEAP_CORRUPTION', 'The heap is corrupted (memory was written past its end).'],
    0xC0000409: ['STATUS_STACK_BUFFER_OVERRUN', 'A stack-protection or fast-fail check stopped the program (a buffer overrun or a deliberate abort).'],
    0xC0000417: ['STATUS_INVALID_CRUNTIME_PARAMETER', 'The C runtime was given an invalid parameter.'],
    0xC0000420: ['STATUS_ASSERTION_FAILURE', 'An assertion failed.'],
    0xC06D007E: ['VcppException (module not found)', 'A delay-loaded module (DLL) was not found.'],
    0xE06D7363: ['C++ exception (msc)', 'The program threw an unhandled C++ exception.'],
    0xE0434352: ['.NET exception (CLR)', 'The program threw an unhandled .NET exception.'],
    // HRESULTs that show up with the same numbers
    0x80004001: ['E_NOTIMPL', 'Not implemented.'], 0x80004002: ['E_NOINTERFACE', 'No such interface supported.'], 0x80004004: ['E_ABORT', 'Operation aborted.'],
    0x80004005: ['E_FAIL', 'Unspecified failure.'], 0x8000FFFF: ['E_UNEXPECTED', 'Catastrophic failure.'],
    0x80070005: ['E_ACCESSDENIED', 'General access denied error.'], 0x80070006: ['E_HANDLE', 'Invalid handle.'], 0x8007000E: ['E_OUTOFMEMORY', 'Ran out of memory.'],
    0x80070057: ['E_INVALIDARG', 'One or more arguments are invalid.'], 0x80070002: ['HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)', 'The system cannot find the file specified.'],
    0x80070003: ['HRESULT_FROM_WIN32(ERROR_PATH_NOT_FOUND)', 'The system cannot find the path specified.'],
    0x887A0001: ['DXGI_ERROR_INVALID_CALL', 'DirectX: the application made a call that is invalid.'], 0x887A0002: ['DXGI_ERROR_NOT_FOUND', 'DirectX: the item requested was not found.'],
    0x887A0004: ['DXGI_ERROR_UNSUPPORTED', 'DirectX: the requested functionality is not supported by the device or the driver.'],
    0x887A0005: ['DXGI_ERROR_DEVICE_REMOVED', 'DirectX: the graphics device was removed or the driver crashed (see the removed reason).'],
    0x887A0006: ['DXGI_ERROR_DEVICE_HUNG', 'DirectX: the graphics device hung (a GPU timeout).'],
    0x887A0007: ['DXGI_ERROR_DEVICE_RESET', 'DirectX: the graphics device failed because of a badly formed command.'],
    0x887A0020: ['DXGI_ERROR_DRIVER_INTERNAL_ERROR', 'DirectX: the driver hit an internal error and cannot continue.'],
    0x8007007E: ['HRESULT_FROM_WIN32(ERROR_MOD_NOT_FOUND)', 'The specified module could not be found.'],
  },
  FACILITIES: { 0: 'FACILITY_NULL', 1: 'FACILITY_RPC_RUNTIME', 3: 'FACILITY_IO_ERROR_CODE', 7: 'FACILITY_WIN32 (as an HRESULT)', 8: 'FACILITY_WINDOWS', 10: 'FACILITY_URT', 0x7A: 'FACILITY_DXGI', 0x6D: 'FACILITY_VISUALC' },
  // value: an unsigned 32-bit number. -> { value, hex, name, meaning, known, severity, customer, facility, code }
  ntstatus(value) {
    const v = Number(value) >>> 0;
    const e = this.NTSTATUS[v];
    const sev = ['Success', 'Informational', 'Warning', 'Error'][v >>> 30];
    return {
      value: v, hex: '0x' + v.toString(16).toUpperCase().padStart(8, '0'),
      name: e ? e[0] : '', meaning: e ? e[1] : '', known: !!e,
      severity: sev, customer: ((v >>> 29) & 1) === 1, facility: (v >>> 16) & 0x0fff, code: v & 0xffff,
    };
  },
  facilityName(n) { return this.FACILITIES[n] || ''; },
  // Win32 error carried in an HRESULT (0x8007xxxx).
  win32InHresult(v) { return ((v >>> 16) & 0x1fff) === 7 ? this.win32(v & 0xffff) : null; },

  // ---- EFI_STATUS --------------------------------------------------------------------------------------------------
  EFI_ERR: {
    1: ['EFI_LOAD_ERROR', 'The image failed to load.'], 2: ['EFI_INVALID_PARAMETER', 'A parameter was incorrect.'], 3: ['EFI_UNSUPPORTED', 'The operation is not supported.'],
    4: ['EFI_BAD_BUFFER_SIZE', 'The buffer was not the proper size for the request.'], 5: ['EFI_BUFFER_TOO_SMALL', 'The buffer is not large enough; the needed size is returned.'],
    6: ['EFI_NOT_READY', 'There is no data pending; the device is not ready.'], 7: ['EFI_DEVICE_ERROR', 'The physical device reported an error.'],
    8: ['EFI_WRITE_PROTECTED', 'The device cannot be written to.'], 9: ['EFI_OUT_OF_RESOURCES', 'A resource has run out.'], 10: ['EFI_VOLUME_CORRUPTED', 'An inconsistency was found on the file system.'],
    11: ['EFI_VOLUME_FULL', 'There is no more space on the file system.'], 12: ['EFI_NO_MEDIA', 'The device does not contain any medium.'],
    13: ['EFI_MEDIA_CHANGED', 'The medium has changed since the last access.'], 14: ['EFI_NOT_FOUND', 'The item was not found.'], 15: ['EFI_ACCESS_DENIED', 'Access was denied.'],
    16: ['EFI_NO_RESPONSE', 'The server was not found or did not respond.'], 17: ['EFI_NO_MAPPING', 'A mapping to a device does not exist.'], 18: ['EFI_TIMEOUT', 'The timeout elapsed.'],
    19: ['EFI_NOT_STARTED', 'The protocol has not been started.'], 20: ['EFI_ALREADY_STARTED', 'The protocol has already been started.'], 21: ['EFI_ABORTED', 'The operation was aborted.'],
    22: ['EFI_ICMP_ERROR', 'An ICMP error occurred during the network operation.'], 23: ['EFI_TFTP_ERROR', 'A TFTP error occurred during the network operation.'],
    24: ['EFI_PROTOCOL_ERROR', 'A protocol error occurred during the network operation.'], 25: ['EFI_INCOMPATIBLE_VERSION', 'The function encountered an internal version that was incompatible.'],
    26: ['EFI_SECURITY_VIOLATION', 'The function was not performed due to a security violation (Secure Boot refused the image).'], 27: ['EFI_CRC_ERROR', 'A CRC error was detected.'],
    28: ['EFI_END_OF_MEDIA', 'The beginning or end of media was reached.'], 31: ['EFI_END_OF_FILE', 'The end of the file was reached.'], 32: ['EFI_INVALID_LANGUAGE', 'The language specified was invalid.'],
    33: ['EFI_COMPROMISED_DATA', 'The security status of the data is unknown or compromised.'], 34: ['EFI_IP_ADDRESS_CONFLICT', 'There is an address conflict.'], 35: ['EFI_HTTP_ERROR', 'A HTTP error occurred during the network operation.'],
  },
  EFI_WARN: {
    1: ['EFI_WARN_UNKNOWN_GLYPH', 'The string contained characters that could not be rendered and were skipped.'], 2: ['EFI_WARN_DELETE_FAILURE', 'The handle was closed, but the file was not deleted.'],
    3: ['EFI_WARN_WRITE_FAILURE', 'The handle was closed, but the data to the file was not flushed properly.'], 4: ['EFI_WARN_BUFFER_TOO_SMALL', 'The resulting buffer was too small, and the data was truncated.'],
    5: ['EFI_WARN_STALE_DATA', 'The data has not been updated within the timeframe set by local policy.'], 6: ['EFI_WARN_FILE_SYSTEM', 'The resulting buffer contains UEFI-compliant file system.'],
    7: ['EFI_WARN_RESET_REQUIRED', 'The operation will be processed across a system reset.'],
  },
  // key: 'EFI_NOT_FOUND' or a bigint/Number/hex value. 64-bit status has the error bit at 63, 32-bit at 31.
  efi(key) {
    let bits = 0, code = null;
    if (typeof key === 'string' && /^EFI_[A-Z_]+$/.test(key.toUpperCase())) {
      const name = key.toUpperCase();
      for (const [n, v] of Object.entries(this.EFI_ERR)) if (v[0] === name) return { name, number: Number(n), kind: 'error', meaning: v[1], bits: 0 };
      for (const [n, v] of Object.entries(this.EFI_WARN)) if (v[0] === name) return { name, number: Number(n), kind: 'warning', meaning: v[1], bits: 0 };
      if (name === 'EFI_SUCCESS') return { name, number: 0, kind: 'success', meaning: 'The operation completed successfully.', bits: 0 };
      return null;
    }
    let big;
    try { big = BigInt(key); } catch { return null; }   // vex-allow-empty-catch: not a number means "not an EFI status"
    const err64 = (big >> 63n) === 1n && big <= 0xffffffffffffffffn;
    const err32 = big >= 0x80000000n && big <= 0xffffffffn;
    if (err64) { bits = 64; code = Number(big & 0x7fffffffffffffffn); }
    else if (err32) { bits = 32; code = Number(big & 0x7fffffffn); }
    else if (big >= 0n && big < 0x80000000n) { code = Number(big); }
    else return null;
    if (code === 0 && !bits) return { name: 'EFI_SUCCESS', number: 0, kind: 'success', meaning: 'The operation completed successfully.', bits: 0 };
    const table = bits ? this.EFI_ERR : this.EFI_WARN;
    const e = table[code];
    if (!e) return null;
    return { name: e[0], number: code, kind: bits ? 'error' : 'warning', meaning: e[1], bits };
  },

  // ---- signals (Linux x86/ARM numbers) ---------------------------------------------------------------------------
  SIGNALS: {
    1: ['SIGHUP', 'Terminate', 'The terminal closed or the controlling process ended.'], 2: ['SIGINT', 'Terminate', 'Interrupt from the keyboard (Ctrl+C).'],
    3: ['SIGQUIT', 'Core dump', 'Quit from the keyboard (Ctrl+\\).'], 4: ['SIGILL', 'Core dump', 'Illegal instruction.'], 5: ['SIGTRAP', 'Core dump', 'Trace or breakpoint trap.'],
    6: ['SIGABRT', 'Core dump', 'abort() was called (a failed assertion or a fatal runtime error).'], 7: ['SIGBUS', 'Core dump', 'Bus error: bad memory access (unaligned, or a truncated mapped file).'],
    8: ['SIGFPE', 'Core dump', 'Arithmetic error such as an integer division by zero.'], 9: ['SIGKILL', 'Terminate', 'Killed; it cannot be caught (the OOM killer, kill -9).'],
    10: ['SIGUSR1', 'Terminate', 'User-defined signal 1.'], 11: ['SIGSEGV', 'Core dump', 'Segmentation fault: invalid memory access.'], 12: ['SIGUSR2', 'Terminate', 'User-defined signal 2.'],
    13: ['SIGPIPE', 'Terminate', 'Wrote to a pipe or socket that nobody reads.'], 14: ['SIGALRM', 'Terminate', 'A timer set by alarm() expired.'], 15: ['SIGTERM', 'Terminate', 'Polite request to end (the default of kill).'],
    16: ['SIGSTKFLT', 'Terminate', 'Stack fault on the coprocessor (unused).'], 17: ['SIGCHLD', 'Ignore', 'A child process stopped or ended.'], 18: ['SIGCONT', 'Continue', 'Continue if stopped.'],
    19: ['SIGSTOP', 'Stop', 'Stop the process; it cannot be caught.'], 20: ['SIGTSTP', 'Stop', 'Stop typed at the terminal (Ctrl+Z).'], 21: ['SIGTTIN', 'Stop', 'A background process tried to read the terminal.'],
    22: ['SIGTTOU', 'Stop', 'A background process tried to write the terminal.'], 23: ['SIGURG', 'Ignore', 'Urgent data on a socket.'], 24: ['SIGXCPU', 'Core dump', 'CPU time limit exceeded.'],
    25: ['SIGXFSZ', 'Core dump', 'File size limit exceeded.'], 26: ['SIGVTALRM', 'Terminate', 'Virtual timer expired.'], 27: ['SIGPROF', 'Terminate', 'Profiling timer expired.'],
    28: ['SIGWINCH', 'Ignore', 'The terminal window was resized.'], 29: ['SIGIO', 'Terminate', 'I/O is now possible.'], 30: ['SIGPWR', 'Terminate', 'Power failure.'], 31: ['SIGSYS', 'Core dump', 'Bad system call.'],
  },
  _sigByName: null,
  signal(key) {
    if (!this._sigByName) { this._sigByName = {}; for (const [n, v] of Object.entries(this.SIGNALS)) this._sigByName[v[0]] = Number(n); }
    const k = String(key).trim().toUpperCase();
    const n = /^\d+$/.test(k) ? Number(k) : this._sigByName[k.startsWith('SIG') ? k : 'SIG' + k];
    const e = n == null ? null : this.SIGNALS[n];
    return e ? { number: n, name: e[0], action: e[1], meaning: e[2] } : null;
  },
  // A shell exit status above 128 is 128 + the signal that ended the process.
  exitCode(n) {
    const c = Number(n);
    if (!Number.isInteger(c) || c < 129 || c > 159) return null;
    const s = this.signal(c - 128);
    return s ? { code: c, signal: s } : null;
  },

  // ---- cron --------------------------------------------------------------------------------------------------------
  MACROS: { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' },
  MONTHS: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  DAYS: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  DAY_NAMES: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

  // One field -> sorted list of numbers, or throws why not.
  _field(text, lo, hi, names, label) {
    const out = new Set();
    for (const part of String(text).split(',')) {
      const m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
      if (!m) throw new Error('The ' + label + ' field has a part that is not valid: "' + part + '"');
      const step = m[2] ? Number(m[2]) : 1;
      if (step < 1) throw new Error('A step in the ' + label + ' field must be 1 or more');
      const num = (t) => {
        if (/^\d+$/.test(t)) return Number(t);
        const i = names ? names.indexOf(t.toUpperCase().slice(0, 3)) : -1;
        if (i < 0) throw new Error('"' + t + '" is not valid in the ' + label + ' field');
        return i + (label === 'month' ? 1 : 0);
      };
      let a, b;
      if (m[1] === '*') { a = lo; b = hi; }
      else if (m[1].includes('-')) { [a, b] = m[1].split('-').map(num); }
      else { a = num(m[1]); b = m[2] ? hi : a; }
      // day-of-week 7 is Sunday too (it is allowed up to 7 and stored as 0)
      const top = label === 'day of week' ? 7 : hi;
      if (a < lo || b > top || a > b) throw new Error('"' + part + '" is outside ' + lo + '-' + hi + ' in the ' + label + ' field');
      for (let v = a; v <= b; v += step) out.add(label === 'day of week' && v === 7 ? 0 : v);
    }
    return [...out].sort((x, y) => x - y);
  },
  // "*/5 9-17 * * MON-FRI" or "@daily" -> { fields:{...}, text }. Throws when it is not a five-field cron.
  parseCron(expr) {
    let s = String(expr).trim().replace(/\s+/g, ' ');
    const macro = this.MACROS[s.toLowerCase()];
    if (macro) s = macro;
    const f = s.split(' ');
    if (f.length !== 5) throw new Error('A cron expression has five fields: minute hour day-of-month month day-of-week');
    const fields = {
      minute: this._field(f[0], 0, 59, null, 'minute'), hour: this._field(f[1], 0, 23, null, 'hour'),
      dom: this._field(f[2], 1, 31, null, 'day of month'), month: this._field(f[3], 1, 12, this.MONTHS, 'month'),
      dow: this._field(f[4], 0, 6, this.DAYS, 'day of week'),
    };
    return { fields, domAny: f[2] === '*', dowAny: f[4] === '*', source: s };
  },
  _cronMatches(c, d) {
    // As in Vixie cron: when both day fields are restricted, either one matching is enough.
    const domOk = c.fields.dom.includes(d.getDate()), dowOk = c.fields.dow.includes(d.getDay());
    let dayOk;
    if (c.domAny && c.dowAny) dayOk = true;
    else if (c.domAny) dayOk = dowOk;
    else if (c.dowAny) dayOk = domOk;
    else dayOk = domOk || dowOk;
    return dayOk && c.fields.month.includes(d.getMonth() + 1) && c.fields.hour.includes(d.getHours()) && c.fields.minute.includes(d.getMinutes());
  },
  // The next `count` times (local time of this computer), looking at most about two years ahead.
  cronNext(expr, count = 3, now = Date.now()) {
    const c = typeof expr === 'string' ? this.parseCron(expr) : expr;
    const out = [];
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 2 * 366 * 24 * 60 && out.length < count; i++) {
      if (this._cronMatches(c, d)) out.push(new Date(d));
      d.setMinutes(d.getMinutes() + 1);
    }
    return out;
  },
  // A plain-words reading, built from the parsed fields.
  cronWords(expr) {
    const c = typeof expr === 'string' ? this.parseCron(expr) : expr;
    const f = c.fields;
    const list = (arr, fmt) => arr.length > 6 ? fmt(arr[0]) + ' to ' + fmt(arr[arr.length - 1]) + ' (' + arr.length + ' values)' : arr.map(fmt).join(', ');
    const pad = (n) => String(n).padStart(2, '0');
    const every = (arr, max) => arr.length === max;
    const parts = [];
    if (every(f.minute, 60) && every(f.hour, 24)) parts.push('every minute');
    else if (f.minute.length === 1 && every(f.hour, 24)) parts.push('at minute ' + f.minute[0] + ' of every hour');
    else if (every(f.hour, 24)) parts.push('at minutes ' + list(f.minute, String) + ' of every hour');
    else if (f.minute.length === 1 && f.hour.length <= 6) parts.push('at ' + f.hour.map(h => pad(h) + ':' + pad(f.minute[0])).join(', '));
    else parts.push('at minutes ' + list(f.minute, String) + ' past hours ' + list(f.hour, String));
    if (!(c.domAny && c.dowAny) || !every(f.month, 12)) {
      if (!c.domAny) parts.push('on day ' + list(f.dom, String) + ' of the month');
      if (!c.dowAny) parts.push((c.domAny ? 'on ' : 'or on ') + list(f.dow, (n) => this.DAY_NAMES[n]));
      if (!every(f.month, 12)) parts.push('in ' + list(f.month, (n) => this.MONTH_NAMES[n - 1]));
    } else parts.push('every day');
    return parts.join(', ');
  },
};

if (typeof window !== 'undefined') window.VexDecodeTables = VexDecodeTables;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDecodeTables };
