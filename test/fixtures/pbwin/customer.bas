' Customer Maintenance -- a PowerBASIC for Windows DDT dialog fixture.
' PowerBASIC keywords are case-insensitive; this file mixes case on purpose
' to prove the reader does not care.

DIALOG NEW 0, "Customer Maintenance", , , 300, 240, %WS_SYSMENU, TO hDlg

CONTROL ADD LABEL, hDlg, 100, "Cust No:", 10, 10, 80, 20
control add TEXTBOX, hDlg, 101, "", 100, 10, 100, 20
CONTROL ADD CHECKBOX, hDlg, 102, "Active", 10, 40, 100, 20

' a run of two consecutive OPTION controls forms one group
CONTROL ADD OPTION, hDlg, 103, "Small", 10, 70, 80, 20
CONTROL ADD OPTION, hDlg, 104, "Medium", 100, 70, 80, 20

' a FRAME breaks the run; its own text renders as a heading
CONTROL ADD FRAME, hDlg, 105, "Shipping", 10, 100, 200, 60

' this OPTION starts a new group, since a non-OPTION control came between
CONTROL ADD OPTION, hDlg, 106, "Overnight", 10, 130, 100, 20

' an unrecognised control type: named through a note, never approximated
CONTROL ADD LISTBOX, hDlg, 107, "", 10, 170, 150, 60

' a CONTROL ADD statement continued across lines with a trailing underscore
CONTROL ADD BUTTON, hDlg, 108, "OK", _
    10, 240, 80, 25, CALL OkProc

' a button with no CALL clause at all: named as unwired
CONTROL ADD BUTTON, hDlg, 109, "Cancel", 100, 240, 80, 25

REM DIALOG SHOW MODAL carries no field content this reader needs
DIALOG SHOW MODAL hDlg

DIALOG NEW 0, "Order Detail", , , 260, 160, %WS_SYSMENU, TO hOrderDlg
CONTROL ADD LABEL, hOrderDlg, 200, "Order No:", 10, 10, 80, 20
CONTROL ADD TEXTBOX, hOrderDlg, 201, "", 100, 10, 100, 20

DIALOG SHOW MODAL hOrderDlg
