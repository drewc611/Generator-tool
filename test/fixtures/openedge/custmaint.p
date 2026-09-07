DEFINE VARIABLE custNo AS INTEGER FORMAT ">>>>>>9" LABEL "Cust No" .
DEFINE VARIABLE custName AS CHARACTER FORMAT "X(30)" LABEL "Name" .
DEFINE VARIABLE activeFlag AS LOGICAL LABEL "Active" .
DEFINE VARIABLE internalNote AS CHARACTER .

DEFINE BUTTON btnOk LABEL "OK".
DEFINE BUTTON btnCancel LABEL "Cancel".
DEFINE BUTTON btnHelp LABEL "Help".
DEFINE BUTTON btnGhost.

FORM
    custNo
    custName
    activeFlag
    internalNote
    btnOk btnCancel btnHelp
    ghostField
WITH FRAME frmMain.

FORM
    custNo
WITH FRAME frmLookup.

ON CHOOSE OF btnOk IN FRAME frmMain DO:
    RUN handleOk.
END.

ON CHOOSE OF btnCancel IN FRAME frmMain DO:
    MESSAGE "are you sure" VIEW-AS ALERT-BOX.
    RETURN.
END.
