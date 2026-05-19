create table testtable (
    id int serial primary key,
    name varchar(50) default 'defname',
    email varchar(30) unique,
    createdAt TIMESTAMP default NOW()
);

insert into testtable(name, email) values('tejas shastri', 'tejas@mail.com');

select * from testtable;