* Customer maintenance screen
PRIVATE custno, custname, activeflag, okflag
custno := SPACE(8)
custname := SPACE(30)
activeflag := "N"

@ 1, 1 SAY "CUSTOMER MAINTENANCE"
@ 3, 1 SAY "Cust No:" GET custno PICTURE "999999"
@ 5, 1 SAY "Name:" GET custname VALID !EMPTY(custname)
@ 7, 1 SAY "Active:" ;
  GET activeflag PICTURE "Y"
READ

IF LASTKEY() = 27
   RETURN
ENDIF

* Second screen: a confirmation with nothing to validate
@ 1, 1 SAY "CONFIRM DELETE?"
@ 3, 1 SAY "Press Y or N:" GET okflag
READ
